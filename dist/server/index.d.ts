import { SupabaseClient } from '@supabase/supabase-js';

type FeedbackRecord = {
    id: string;
    project_id: string;
    feedback_text: string;
    transcript_original: string | null;
    annotation_data: {
        version: 1;
        marks: Array<{
            tool: string;
            points: Array<{
                x: number;
                y: number;
            }>;
        }>;
    };
    page_url: string | null;
    route: string | null;
    browser: string | null;
    browser_version: string | null;
    operating_system: string | null;
    operating_system_version: string | null;
    device_type: "mobile" | "tablet" | "desktop" | null;
    viewport: {
        width: number;
        height: number;
    } | null;
    screen_size: {
        width: number;
        height: number;
    } | null;
    pixel_ratio: number | null;
    touch_enabled: boolean | null;
    display_mode: "standalone" | "browser" | null;
    app_version: string | null;
    metadata: {
        capture_source?: "automatic" | "manual";
        category?: "bug" | "idea" | "design" | "general";
        steps?: Array<{
            seconds_before: number;
            kind: "click" | "error" | "request";
            label: string;
            area?: string;
            route: string;
            count?: number;
        }>;
        app_context?: Record<string, string | number | boolean | null>;
        format?: Partial<{
            orientation: "portrait" | "landscape";
            aspect_ratio: number;
            color_scheme: "dark" | "light";
            language: string;
            scroll: {
                y: number;
                height: number;
            };
        }>;
    };
};
type PointOutStore = {
    save: (record: FeedbackRecord, image: {
        bytes: Uint8Array;
        mime: string;
        extension: string;
    } | null) => Promise<void>;
};
type PointOutServerOptions = {
    projectId: string;
    store: PointOutStore;
    /** Use the host app's persistent rate limiter. Return false when the request exceeds its limit. */
    rateLimit: (request: Request, operation: "feedback" | "transcribe") => Promise<boolean> | boolean;
    transcribe: (audio: File) => Promise<string>;
};
declare function createPointOutHandlers(options: PointOutServerOptions): {
    feedback: (request: Request) => Promise<Response>;
    transcribe: (request: Request) => Promise<Response>;
};
declare function createOpenAITranscriber(apiKey: string, model?: string): (audio: File) => Promise<string>;
declare function createSupabaseStore(client: SupabaseClient, bucket?: string): PointOutStore;
/** Persistent per-project limiter. identify must use a trusted server-side user/session or proxy identity. */
declare function createSupabaseRateLimiter(client: SupabaseClient, options: {
    projectId: string;
    secret: string;
    identify: (request: Request) => string | null | Promise<string | null>;
    feedbackPerHour?: number;
    transcriptionsPerHour?: number;
}): PointOutServerOptions["rateLimit"];

export { type PointOutServerOptions, type PointOutStore, createOpenAITranscriber, createPointOutHandlers, createSupabaseRateLimiter, createSupabaseStore };
