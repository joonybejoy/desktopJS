/**
 * @module @morgan-stanley/desktopjs
 */

import { Container, WebContainerBase } from "../container";
import { ContainerWindow, PersistedWindowLayout, Rectangle, WindowEventArgs } from "../window";
import { ScreenManager, Display, Point } from "../screen";
import { NotificationOptions } from "../notification";
import { ObjectTransform, PropertyMap } from "../propertymapping";
import { Guid } from "../guid";
import { MessageBus, MessageBusSubscription, MessageBusOptions } from "../ipc";
import { EventArgs } from "../events";

declare let Notification: any;

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Default {
    const windowEventMap = {
        close: "unload"
    };

    /**
     * @augments ContainerWindow
     */
    export class DefaultContainerWindow extends ContainerWindow {
        public constructor(wrap: any) {
            super(wrap);
        }

        public get id(): string {
            return this.innerWindow[DefaultContainer.windowUuidPropertyKey];
        }

        public get name(): string {
            return this.innerWindow[DefaultContainer.windowNamePropertyKey];
        }

        public load(url: string, options?: any): Promise<void> {
            return new Promise<void>(resolve => {
                this.innerWindow.location.replace(url);
                resolve();
            });
        }

        public focus(): Promise<void> {
            this.innerWindow.focus();
            return Promise.resolve();
        }

        public show(): Promise<void> {
            return Promise.resolve();
        }

        public hide(): Promise<void> {
            return Promise.resolve();
        }

        public close(): Promise<void> {
            this.innerWindow.close();
            return Promise.resolve();
        }

        public minimize(): Promise<void> {
            return new Promise<void>(resolve => {
                this.innerWindow.minimize();
                resolve();
            });
        }

        public maximize(): Promise<void> {
            return new Promise<void>(resolve => {
                this.innerWindow.maximize();
                resolve();
            });
        }

        public restore(): Promise<void> {
            return new Promise<void>(resolve => {
                this.innerWindow.restore();
                resolve();
            });
        }

        public isShowing(): Promise<boolean> {
            // https://github.com/ai/visibilityjs ?
            return Promise.resolve(true);
        }

        public getSnapshot(): Promise<string> {
            return Promise.reject("getSnapshot requires an implementation.");
        }

        public flash(enable: boolean, options?: any): Promise<void> {
            return Promise.reject("Not supported");
        }

        public getParent(): Promise<ContainerWindow> {
            // on the web, there's no parent
            return Promise.resolve(null);
        }

        public setParent(parent: ContainerWindow): Promise<void> {
            return Promise.resolve();
        }

        public getBounds(): Promise<Rectangle> {
            return new Promise<Rectangle>(resolve => {
                resolve(new Rectangle(this.innerWindow.screenX, this.innerWindow.screenY, this.innerWindow.outerWidth, this.innerWindow.outerHeight));
            });
        }

        public setBounds(bounds: Rectangle): Promise<void> {
            return new Promise<void>(resolve => {
                this.innerWindow.moveTo(bounds.x, bounds.y);
                this.innerWindow.resizeTo(bounds.width, bounds.height);
                resolve();
            });
        }

        public getOptions(): Promise<any> {
            return new Promise<any>((resolve) => {
                resolve(this.innerWindow[Container.windowOptionsPropertyKey]);
            });
        }

        public getState(): Promise<any> {
            return new Promise<any>(resolve => {
                (this.nativeWindow && (<any>this.nativeWindow).getState) ? resolve((<any>this.nativeWindow).getState()) : resolve(undefined);
            });
        }

        public setState(state: any): Promise<void> {
            return new Promise<void>(resolve => {
                if (this.nativeWindow && (<any>this.nativeWindow).setState) {
                    (<any>this.nativeWindow).setState(state);
                }

                resolve();
            }).then(() => {
                this.emit("state-changed", <EventArgs> { name: "state-changed", sender: this, state: state });
                ContainerWindow.emit("state-changed", <WindowEventArgs> { name: "state-changed", windowId: this.id, state: state } );
            });
        }

        protected attachListener(eventName: string, listener: (...args: any[]) => void): void {
            this.innerWindow.addEventListener(windowEventMap[eventName] || eventName, listener);
        }

        protected detachListener(eventName: string, listener: (...args: any[]) => void): void {
            this.innerWindow.removeEventListener(windowEventMap[eventName] || eventName, listener);
        }

        public get nativeWindow(): Window {
            return this.innerWindow;
        }
    }

    /**
     * @augments MessageBus
     */
    export class DefaultMessageBus implements MessageBus {
        private container: DefaultContainer;
        private static readonly messageSource: string = "desktopJS";

        constructor(container: DefaultContainer) {
            this.container = container;
        }

        subscribe<T>(topic: string, listener: (event: any, message: T) => void, options?: MessageBusOptions): Promise<MessageBusSubscription> {
            return new Promise<MessageBusSubscription>((resolve) => {
                const subscription: MessageBusSubscription = new MessageBusSubscription(topic, (event: any) => {
                    // Only allow same origin
                    if (event.origin !== this.container.globalWindow.location.origin) {
                        return;
                    }

                    // Make sure topic received matches the one that was subscribed
                    const { source, "topic": receivedTopic, message } = event.data;

                    if (source === DefaultMessageBus.messageSource && topic === receivedTopic) {
                        listener({ topic: topic }, message);
                    }
                });

                if (this.container.globalWindow && this.container.globalWindow.addEventListener) {
                    this.container.globalWindow.addEventListener("message", subscription.listener);
                }

                resolve(subscription);
            });
        }

        unsubscribe(subscription: MessageBusSubscription): Promise<void> {
            return Promise.resolve(this.container.globalWindow.removeEventListener("message", subscription.listener));
        }

        publish<T>(topic: string, message: T, options?: MessageBusOptions): Promise<void> {
            // Get list of windows from global (set by opener on creation) or fallback to opener global in case
            // there is a race condition of getting here before the opener set the global for us
            const windows: Window[] = (this.container.globalWindow)
                ? this.container.globalWindow[DefaultContainer.windowsPropertyKey]
                || (this.container.globalWindow.opener && this.container.globalWindow.opener[DefaultContainer.windowsPropertyKey])
                : [];

            if (windows) {
                for (const key in windows) {
                    const win = windows[key];

                    if (options && options.name && options.name !== win[DefaultContainer.windowNamePropertyKey]) {
                        continue;
                    }

                    const targetOrigin = options?.targetOrigin || this.container.globalWindow.location.origin;
                    win.postMessage({ source: DefaultMessageBus.messageSource, topic: topic, message: message }, targetOrigin);
                }
            }

            return Promise.resolve();
        }
    }

    /**
     * @augments WebContainerBase
     */
    export class DefaultContainer extends WebContainerBase {
        private mainWindow: ContainerWindow;

        public static readonly windowsPropertyKey: string = "desktopJS-windows";
        public static readonly windowUuidPropertyKey: string = "desktopJS-uuid";
        public static readonly windowNamePropertyKey: string = "desktopJS-name";

        private static readonly rootWindowUuid: string = "root";

        public static readonly defaultWindowOptionsMap: PropertyMap = {
            x: { target: "left" },
            y: { target: "top" }
        };

        public windowOptionsMap: PropertyMap = DefaultContainer.defaultWindowOptionsMap;

        public constructor(win?: Window) {
            super(win);
            this.hostType = "Default";

            this.ipc = this.createMessageBus();

            // Create a global windows object for tracking all windows and add the current global window for current
            if (this.globalWindow && !(DefaultContainer.windowsPropertyKey in this.globalWindow)) {
                this.globalWindow[DefaultContainer.windowsPropertyKey] = { root: this.globalWindow };
                this.globalWindow[DefaultContainer.windowNamePropertyKey] = this.globalWindow[DefaultContainer.windowUuidPropertyKey] = DefaultContainer.rootWindowUuid;
            }

            this.screen = new DefaultDisplayManager(this.globalWindow);
        }

        protected createMessageBus(): MessageBus {
            return new DefaultMessageBus(this);
        }

        public setOptions(options: any) {
            // noop. Any override to be done in overriding containers.
        }

        public getOptions(): Promise<any> {
            // noop. Any override to be done in overriding containers.
            return Promise.resolve({});
        }

        public getInfo(): Promise<string | undefined> {
            return Promise.resolve(this.globalWindow.navigator.appVersion);
        }

        public getMainWindow(): ContainerWindow {
            if (!this.mainWindow) {
                const win = this.globalWindow[DefaultContainer.windowsPropertyKey].root;
                this.mainWindow = win ? this.wrapWindow(win) : null;
            }

            return this.mainWindow;
        }

        public getCurrentWindow(): ContainerWindow {
            return this.wrapWindow(this.globalWindow);
        }

        protected getWindowOptions(options?: any): any {
            return ObjectTransform.transformProperties(options, this.windowOptionsMap);
        }

        public wrapWindow(containerWindow: any) {
            return new DefaultContainerWindow(containerWindow);
        }

        protected onOpen(open: (...args: any[]) => Window, ...args: any[]): Window {
            const window = open.apply(this.globalWindow, args);
            const uuid = Guid.newGuid();

            try {
                const windows = this.globalWindow[DefaultContainer.windowsPropertyKey];
                windows[uuid] = window;
                window[DefaultContainer.windowUuidPropertyKey] = uuid;

                // Attach event handlers on window to cleanup reference on global windows object.  beforeunload -> unload to prevent
                // unload being called on open within Chrome.
                window.addEventListener("beforeunload", () => {
                    window.addEventListener("unload", () => {
                        delete windows[uuid];
                    });
                });

                // Propagate the global windows object to the new window
                window[DefaultContainer.windowsPropertyKey] = windows;
            } catch (e) {
                this.log("warn", `Error tracking new window, '${e.message}'`);
            }

            Container.emit("window-created", { name: "window-created", windowId: uuid });
            ContainerWindow.emit("window-created", { name: "window-created", windowId: uuid });

            return window;
        }

        public createWindow(url: string, options?: any): Promise<ContainerWindow> {
            let features: string;
            let target = "_blank";

            const newOptions = this.getWindowOptions(options);

            if (newOptions) {
                for (const prop in newOptions) {
                    features = (features ? features : "") + prop + "=" + newOptions[prop] + ",";
                }

                if (newOptions && "target" in newOptions) {
                    target = newOptions.target;
                }
            }

            const window = this.globalWindow.open(url, target, features);
            let windowReachable = true;

            try {
                window[Container.windowOptionsPropertyKey] = options; // Store the original options

                // Set name as a unique desktopJS name property instead of overloading window.name
                window[DefaultContainer.windowNamePropertyKey] = newOptions.name;
            } catch (e) {
                windowReachable = false;
                this.log("warn",`Error proprogating properties to new window, '${e.message}'`);
            }

            const newWindow = this.wrapWindow(window);
            this.emit("window-created", { sender: this, name: "window-created", window: newWindow, windowId: windowReachable ? newWindow.id : undefined, windowName: newOptions.name });

            return Promise.resolve(newWindow);
        }

        public showNotification(title: string, options?: NotificationOptions) {
            if (!("Notification" in this.globalWindow)) {
                this.log("warn", "Notifications not supported");
                return;
            }

            (<any>this.globalWindow).Notification.requestPermission(permission => {
                if (permission === "denied") {
                    this.log("warn", "Notifications not permitted");
                } else if (permission === "granted") {
                    new (<any>this.globalWindow).Notification(title, options); 
                }
            });
        }

        protected closeAllWindows(excludeSelf?: boolean): Promise<void> {
            return new Promise<void>((resolve) => {
                const windows = this.globalWindow[DefaultContainer.windowsPropertyKey];
                for (const key in windows) {
                    const win = windows[key];
                    if (!excludeSelf || this.globalWindow !== win) {
                        win.close();
                    }
                }
                resolve();
            });
        }

        public getAllWindows(): Promise<ContainerWindow[]> {
            return new Promise<ContainerWindow[]>((resolve) => {
                const windows: ContainerWindow[] = [];
                const trackedWindows = this.globalWindow[DefaultContainer.windowsPropertyKey];
                for (const key in trackedWindows) {
                    windows.push(this.wrapWindow(trackedWindows[key]));
                }
                resolve(windows);
            });
        }

        public getWindowById(id: string): Promise<ContainerWindow | null> {
            return new Promise<ContainerWindow>((resolve) => {
                const win = this.globalWindow[DefaultContainer.windowsPropertyKey][id];
                resolve(win ? this.wrapWindow(win) : null);
            });
        }

        public getWindowByName(name: string): Promise<ContainerWindow | null> {
            return new Promise<ContainerWindow>((resolve) => {
                const trackedWindows = this.globalWindow[DefaultContainer.windowsPropertyKey];
                for (const key in trackedWindows) {
                    if (trackedWindows[key][DefaultContainer.windowNamePropertyKey] === name) {
                        resolve(this.wrapWindow(trackedWindows[key]));
                        return;
                    }
                }

                resolve(null);
            });
        }

        public buildLayout(): Promise<PersistedWindowLayout> {
            const layout = new PersistedWindowLayout();

            return new Promise<PersistedWindowLayout>((resolve, reject) => {
                const promises: Promise<void>[] = [];

                this.getAllWindows().then(windows => {
                    windows.forEach(window => {
                        const nativeWin = window.nativeWindow;

                        try {
                            const options = nativeWin[Container.windowOptionsPropertyKey];
                            if (options && "persist" in options && !options.persist) {
                                return;
                            }

                            // eslint-disable-next-line no-async-promise-executor
                            promises.push(new Promise<void>(async (innerResolve) => {
                                if (this.globalWindow !== nativeWin) {
                                    layout.windows.push(
                                        {
                                            name: window.name,
                                            url: (nativeWin && nativeWin.location) ? nativeWin.location.toString() : undefined,
                                            id: window.id,
                                            bounds: { x: nativeWin.screenX, y: nativeWin.screenY, width: nativeWin.innerWidth, height: nativeWin.innerHeight },
                                            options: options,
                                            state: await window.getState()
                                        }
                                    );
                                }
                                innerResolve();
                            }));
                        } catch (e) {
                            // An error can happen if the window is not same origin and due to async loading we were able to
                            // add tracking to it before the content was loaded so we have a window with tracking in which we
                            // can't access properties any more so we will skip it with warning
                            this.log('warn', `Error while accessing window so skipping, '${e.message}'`);
                        }
                    });

                    Promise.all(promises).then(() => {
                        resolve(layout);
                    }).catch(reject);
                });
            });
        }
    }

    /** @private */
    class DefaultDisplayManager implements ScreenManager {
        public readonly window: Window;

        public constructor(window: Window) {
            this.window = window;
        }

        public getPrimaryDisplay(): Promise<Display> {
            return new Promise<Display>(resolve => {
                const display = new Display();
                display.scaleFactor = this.window.devicePixelRatio;
                display.id = "Current";

                display.bounds = new Rectangle((<any>this.window.screen).availLeft,
                    (<any>this.window.screen).availTop,
                    this.window.screen.width,
                    this.window.screen.height);

                display.workArea = new Rectangle((<any>this.window.screen).availLeft,
                    (<any>this.window.screen).availTop,
                    this.window.screen.availWidth,
                    this.window.screen.availHeight);

                resolve(display);
            });
        }

        public getAllDisplays(): Promise<Display[]> {
            return new Promise<Display[]>(resolve => {
                this.getPrimaryDisplay().then(display => resolve([display]));
            });
        }

        public getMousePosition(): Promise<Point> {
            return new Promise<Point>((resolve) => {
                resolve({ x: (<any>this.window.event).screenX, y: (<any>this.window.event).screenY });
            });
        }
    }
}