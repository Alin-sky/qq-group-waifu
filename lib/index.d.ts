import { Context, Schema } from 'koishi';
export declare const name = "tianqi";
export interface Config {
}
export declare const Config: Schema<Config>;
type md_format = {
    msg_id?: string;
    event_id?: string;
    msg_type: number;
    markdown: {
        content: any;
    };
};
export declare function send_md_mess(session: any, md: md_format): Promise<void>;
export declare function apply(ctx: Context): Promise<void>;
export {};
