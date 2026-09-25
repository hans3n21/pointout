import * as react from 'react';

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
};
declare function PointOutWidget({ projectId, projectName, appVersion, feedbackUrl, transcribeUrl, sessionId, targetType, targetRef, triggerVariant, }: PointOutWidgetProps): react.JSX.Element;

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
};
declare function safePageUrl(href: string): string;
declare function collectDeviceContext(env?: BrowserEnvironment): Promise<DeviceContext>;

export { type AnnotationMark, type AnnotationTool, type DeviceContext, type Point, PointOutWidget, type PointOutWidgetProps, collectDeviceContext, safePageUrl };
