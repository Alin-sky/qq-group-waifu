import { Context, Schema } from 'koishi';
export declare const name = "qq-group-waifu";
export interface Config {
    days: number;
    hours: number;
    meme_api: string;
    bot_appId: string;
}
export declare const Config: Schema<Config>;
export declare const inject: {
    required: string[];
};
declare module 'koishi' {
    interface Tables {
        qqwaifu_dbs: qqwaifu_dbs;
        qqwaifu_db_marry: qqwaifu_db_marry;
    }
}
export interface qqwaifu_dbs {
    id: string;
    guilds: qqw_user_dbs[];
}
export interface qqw_user_dbs {
    userid: string;
    status_u: boolean;
    timestemp: number;
}
export interface Pairings {
    [userId: string]: string;
}
export interface qqwaifu_db_marry {
    id: string;
    pairings: Pairings;
}
type md_format = {
    msg_id?: string;
    event_id?: string;
    msg_type: number;
    markdown: {
        content: any;
    };
};
export declare function send_md_mess(session: any, md: md_format): Promise<void>;
export declare function apply(ctx: Context, config: Config): Promise<void>;
export {};
