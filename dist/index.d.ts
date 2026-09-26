import * as react from 'react';

/** What the app itself knows about its state (current view, connection, mode). Keep values short. */
type PointOutAppContext = Record<string, string | number | boolean | null>;
type PointOutWidgetProps = {
    projectId: string;
    projectName: string;
    appVersion?: string | null;
    feedbackUrl?: string;
    transcribeUrl?: string;
    sessionId?: string;
    targetType?: "page" | "chat_message" | "chat_session" | "design" | "generation";
    targetRef?: string;
    triggerVariant?: "floating" | "header" | "footer" | "icon";
    /** Read when the dialog opens (max. 1 s); errors are ignored. */
    context?: () => PointOutAppContext | Promise<PointOutAppContext>;
};
declare function PointOutWidget({ projectId, projectName, appVersion, feedbackUrl, transcribeUrl, sessionId, targetType, targetRef, triggerVariant, context, }: PointOutWidgetProps): react.JSX.Element;

type PointOutStepKind = "click" | "error" | "request";
type SentStep = {
    seconds_before: number;
    kind: PointOutStepKind;
    label: string;
    area?: string;
    route: string;
    count?: number;
};

type Point = {
    x: number;
    y: number;
};
type AnnotationTool = "freehand" | "rectangle" | "circle" | "arrow";
type AnnotationMark = {
    tool: AnnotationTool;
    points: Point[];
};

type Brand = {
    brand: string;
    version: string;
};
type UAData = {
    brands?: Brand[];
    mobile?: boolean;
    platform?: string;
    getHighEntropyValues?: (hints: string[]) => Promise<{
        platformVersion?: string;
        fullVersionList?: Brand[];
    }>;
};
type BrowserNavigator = {
    userAgent?: string;
    maxTouchPoints?: number;
    standalone?: boolean;
    language?: string;
    userAgentData?: UAData;
};
type BrowserEnvironment = {
    navigator: BrowserNavigator;
    location: {
        href: string;
        pathname: string;
    };
    innerWidth: number;
    innerHeight: number;
    devicePixelRatio?: number;
    screen: {
        width: number;
        height: number;
    };
    matchMedia?: (query: string) => {
        matches: boolean;
    };
    scrollY?: number;
    document?: {
        documentElement: {
            scrollHeight: number;
        };
    };
};
type DeviceContext = {
    page_url: string;
    route: string;
    timestamp: string;
    browser: string | null;
    browser_version: string | null;
    operating_system: string | null;
    operating_system_version: string | null;
    device_type: "mobile" | "tablet" | "desktop";
    viewport: {
        width: number;
        height: number;
    };
    screen_size: {
        width: number;
        height: number;
    };
    pixel_ratio: number;
    touch_enabled: boolean;
    display_mode: "standalone" | "browser";
    orientation: "portrait" | "landscape";
    aspect_ratio: number;
    color_scheme: "dark" | "light";
    language: string | null;
    scroll: {
        y: number;
        height: number;
    } | null;
};
declare function safePageUrl(href: string): string;
declare function collectDeviceContext(env?: BrowserEnvironment): Promise<DeviceContext>;

export { type AnnotationMark, type AnnotationTool, type DeviceContext, type Point, type PointOutAppContext, PointOutWidget, type PointOutWidgetProps, type SentStep, collectDeviceContext, safePageUrl };
