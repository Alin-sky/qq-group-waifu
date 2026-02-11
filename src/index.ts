/**
 * QQ群老婆配对插件
 * 
 * 功能说明：
 * - 每日随机为群成员配对"老婆"
 * - 支持结婚、离婚功能
 * - 生成趣味表情图（摸头、结婚等）
 * - 定时清理匹配数据
 * 
 * @author Matrix Agent
 * @version 1.0.0
 */

// 导入 Koishi 框架核心模块
import { Context, h, Logger, Random, Schema } from 'koishi'

// 导入 QQ 适配器
import { } from '@satorijs/adapter-qq'

// ============================================================================
// 插件基本信息
// ============================================================================

// 插件名称（供 Koishi 识别）
export const name = 'qq-group-waifu'

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 插件配置项接口
 */
export interface Config {
  /** 用户刷新频率，超过该时间的用户会被删除（单位：天） */
  days: number
  /** 数据刷新时间，小时（24小时制） */
  hours: number
  /** 表情包API地址 */
  meme_api: string
  /** 机器人AppID */
  bot_appId: string
}

/**
 * 配置项Schema定义
 * 用于Koishi管理界面的配置表单
 */
export const Config: Schema<Config> = Schema.object({
  /** 用户刷新频率，超过该时间的用户会被删除（单位：天），范围1-14天 */
  days: Schema.number().min(1).max(14).step(1).default(3).description('用户刷新频率（单位：天）'),
  /** 每日数据刷新时间，24小时制，0-24之间 */
  hours: Schema.number().min(0).max(24).step(1).default(0).description('数据刷新时间（小时）'),
  /** 机器人AppID，用于获取用户头像 */
  bot_appId: Schema.string(),
  /** 表情包生成API地址 */
  meme_api: Schema.string()
})

// ============================================================================
// 数据库注入声明
// ============================================================================

/**
 * 声明需要数据库依赖
 * Koishi 会自动注入 database 插件
 */
export const inject = { required: ['database'] }

// ============================================================================
// 数据库表结构定义
// ============================================================================

/**
 * 扩展 Koishi 的数据库表类型
 * 声明自定义表：qqwaifu_dbs（用户数据）、qqwaifu_db_marry（配对数据）
 */
declare module 'koishi' {
  interface Tables {
    /** 用户数据库 - 存储群成员状态信息 */
    qqwaifu_dbs: qqwaifu_dbs
    /** 婚姻数据库 - 存储用户配对关系 */
    qqwaifu_db_marry: qqwaifu_db_marry
  }
}

/**
 * 用户数据结构
 * 记录每个群成员的状态信息
 */
export interface qqwaifu_dbs {
  /** 群ID（主键） */
  id: string
  /** 群成员列表 */
  guilds: qqw_user_dbs[]
}

/**
 * 单个群成员的数据结构
 */
export interface qqw_user_dbs {
  /** 用户ID */
  userid: string
  /** 配对状态：true=已配对，false=未配对 */
  status_u: boolean
  /** 时间戳，记录用户最后活跃时间 */
  timestemp: number
}

/**
 * 配对关系映射类型
 * key: 用户ID，value: 配对对象的用户ID
 */
export interface Pairings {
  [userId: string]: string;
}

/**
 * 婚姻配对数据结构
 * 记录群内的所有配对关系
 */
export interface qqwaifu_db_marry {
  /** 群ID（主键） */
  id: string
  /** 配对关系映射表 */
  pairings: Pairings;
}

/**
 * Markdown消息格式类型
 * 用于发送富文本消息
 */
type md_format = {
  /** 消息ID（私聊用） */
  msg_id?: string
  /** 事件ID（频道用） */
  event_id?: string
  /** 消息类型 */
  msg_type: number
  /** Markdown内容 */
  markdown: {
    content: any
  }
}

// ============================================================================
// 核心功能函数
// ============================================================================

/**
 * 跨平台消息发送函数
 * 支持 QQ 和 QQ频道 两种平台的消息发送
 * 
 * @param session - Koishi会话对象
 * @param md - Markdown消息格式
 */
export async function send_md_mess(session, md: md_format) {
  try {
    // 判断平台类型
    if (session.event.platform == 'qq') {
      // 判断是否为群聊还是私聊
      if (session.event.guild) {
        // 群聊消息发送
        await session.qq.sendMessage(session.channelId, md)
      } else {
        // 私聊消息发送
        await session.qq.sendPrivateMessage(session.event.user.id, md)
      }
    } else if (session.event.platform == 'qqguild') {
      // QQ频道消息发送
      await session.qqguild.sendMessage(session.event.channel.id, md)
    }
  } catch (e) {
    console.log(e)
  }
}

// ============================================================================
// 插件主逻辑
// ============================================================================

/**
 * 插件应用入口函数
 * 
 * @param ctx - Koishi上下文对象
 * @param config - 插件配置
 */
export async function apply(ctx: Context, config: Config) {

  // -------------------------------------------------------------------------
  // 1. 数据库初始化
  // -------------------------------------------------------------------------
  
  /**
   * 创建用户数据表
   * 表名：qqwaifu_dbs
   * 字段：id（群ID）, guilds（群成员列表，JSON格式）
   */
  ctx.model.extend('qqwaifu_dbs', {
    id: "string",
    guilds: "json",
  })
  
  /**
   * 创建婚姻配对表
   * 表名：qqwaifu_db_marry
   * 字段：id（群ID）, pairings（配对关系，JSON格式）
   */
  ctx.model.extend('qqwaifu_db_marry', {
    id: "string",
    pairings: "json"
  })

  // 初始化日志记录器
  const log1 = "qq-guild-waifu"
  const log: Logger = new Logger(log1)
  
  // 初始化随机数生成器
  const random = new Random(() => Math.random())

  // 机器人信息存储（用于配对到机器人时使用）
  const bots_ass = {
    id: '',
    url: ''
  }

  // -------------------------------------------------------------------------
  // 2. 定时任务调度
  // -------------------------------------------------------------------------

  /**
   * 调度每日午夜任务
   * 每天凌晨0点执行指定任务
   * 
   * @param taskFunction - 要执行的任务函数
   */
  function scheduleMidnightTask(taskFunction: () => void): void {
    // 获取当前时间
    const now = new Date();
    // 计算下一个午夜时间
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    // 计算延迟毫秒数
    const delay = nextMidnight.getTime() - now.getTime();

    // 设置定时器
    setTimeout(() => {
      taskFunction(); // 执行任务
      scheduleMidnightTask(taskFunction); // 重新调度，实现循环
    }, delay);
  }

  /**
   * 清理配对数据任务
   * 每天午夜执行，清空所有配对记录
   * 实现每日重新配对的功能
   */
  async function delet_wifes(): Promise<void> {
    console.log("执行任务，当前时间：", new Date());
    // 清空配对表
    await ctx.database.remove("qqwaifu_db_marry", {})
    console.log(await ctx.database.get("qqwaifu_db_marry", {}))
  }

  // 启动定时任务（每日午夜清理配对数据）
  await scheduleMidnightTask(delet_wifes);

  // -------------------------------------------------------------------------
  // 3. 用户数据管理
  // -------------------------------------------------------------------------

  /**
   * 保存/更新用户数据
   * 当用户首次使用或每次使用时更新其时间戳
   * 
   * @param session - Koishi会话对象
   */
  let i = 0
  async function save_user(session) {
    // 从数据库获取当前群的用户数据
    const user_data = (await ctx.database.get("qqwaifu_dbs", session.event.guild?.id))
    // 计算刷新时间点（当天的config.hours点）
    const etime = new Date().setHours(config.hours, 0, 0, 0)
    let indata: qqw_user_dbs
    
    // 情况1：群数据为空，创建新记录
    if (user_data.length == 0) {
      await ctx.database.upsert('qqwaifu_dbs', () => [
        {
          id: session.event.guild.id,
          guilds: [
            {
              userid: session.event.user.id,
              status_u: false,
              timestemp: etime
            },
            {
              userid: "bots",  // 保留机器人位置，用于与机器人配对
              status_u: false,
              timestemp: 17000000000000  // 一个很远的未来时间
            },
          ],
        }
      ])
    } 
    // 情况2：用户已有记录，检查是否需要更新
    else if ((user_data[0].guilds).find(a => a.userid == session.event.user.id)) {
      const ind = user_data[0].guilds.findIndex(a => a.userid == session.event.user.id)
      
      // 如果新的刷新时间晚于记录时间，更新时间戳并重置配对状态
      if (etime > user_data[0].guilds[ind].timestemp) {
        indata = {
          userid: session.event.user.id,
          status_u: false,
          timestemp: etime
        }
        user_data[0].guilds[ind] = indata
      } 
      // 如果在同一天，只更新时间戳，保持配对状态
      else if (etime <= user_data[0].guilds[ind].timestemp) {
        indata = {
          userid: session.event.user.id,
          status_u: user_data[0].guilds[ind].status_u,
          timestemp: etime
        }
        user_data[0].guilds[ind] = indata
      }
      // 更新到数据库
      await ctx.database.upsert('qqwaifu_dbs', () => [
        {
          id: session.event.guild.id,
          guilds: user_data[0].guilds,
        }
      ])
    } 
    // 情况3：新用户加入，追加到群用户列表
    else {
      indata = {
        userid: session.event.user.id,
        status_u: false,
        timestemp: etime
      };
      (user_data[0].guilds).push(indata)

      try {
        await ctx.database.upsert('qqwaifu_dbs', () => [
          {
            id: session.event.guild?.id,
            guilds: user_data[0].guilds,
          }
        ])
      } catch (e) {
        console.log(e)
        return
      }
    }
  }

  /**
   * 获取可配对的群成员
   * 根据用户活跃时间和配对状态筛选可用用户
   * 
   * @param guild_users - 群成员列表
   * @param session - Koishi会话对象
   * @returns 配对成功的用户对象，或false（无可配对用户）
   */
  async function ga_user(guild_users: qqw_user_dbs[], session) {
    // 获取当天刷新时间点
    const etime = new Date().setHours(config.hours, 0, 0, 0)

    // 遍历所有群成员
    for (let i = 0; i < guild_users.length; i++) {
      // 计算距离上次刷新的时间差
      const calcula = etime - (guild_users[i].timestemp)
      
      // 如果超过配置的天数，移除该用户
      if (calcula >= (config.days * 86400000)) {
        guild_users.splice(i, 1)
      } 
      // 如果在配置天数内但不为0，重置其配对状态为未配对
      else if (calcula < (config.days * 86400000) && calcula != 0) {
        guild_users[i].status_u = false
      }
    }
    
    // 筛选出未配对的用户
    const l_1 = guild_users.filter((i) => i.status_u == false)
    // 排除自己
    const l_2 = l_1.filter(i => i.userid != session.event.user.id)
    
    // 更新数据库
    ctx.database.upsert("qqwaifu_dbs", [{
      id: session.event.guild.id,
      guilds: guild_users
    }])

    // 如果没有可配对用户，返回false
    if (l_2.length == 0) {
      return false
    } else {
      // 随机选择一个用户作为"老婆"
      const wife = random.pick(l_2)
      return wife
    }
  }

  // -------------------------------------------------------------------------
  // 4. 中间件处理
  // -------------------------------------------------------------------------

  /**
   * Koishi中间件
   * 拦截所有消息，自动保存用户数据
   */
  ctx.middleware(async (session, next) => {
    // 只处理群消息
    if (!session.event.guild) {
      return next()
    } else {
      // 保存用户数据
      await save_user(session)
      return next()
    }
  }, true)

  // -------------------------------------------------------------------------
  // 5. 按钮交互处理
  // -------------------------------------------------------------------------

  /**
   * 处理按钮交互事件
   * 包括：结婚证、摸头、查看菜单等按钮
   */
  ctx.on("interaction/button", async sess => {
    // 先保存用户数据
    await save_user(sess)
    
    // 解析按钮数据（格式："操作名 参数1 参数2"）
    const int_butt_data = sess.event.button['data'].split(' ')
    
    // 根据操作类型处理
    switch (int_butt_data[0]) {
      case 'meme-jiehun':
        // 生成结婚证图片
        let uuuuu
        // 判断是本人还是对方
        if (int_butt_data[1] == sess.event.user.id) {
          uuuuu = int_butt_data[2]
        } else { uuuuu = int_butt_data[1] }
        const tutu = await create_meme(uuuuu, 1)
        sess.send(h.image(tutu, 'image/jpg'))
        break;
        
      case "meme-momotou":
        // 生成摸头图片
        let uuuu
        if (int_butt_data[1] == sess.event.user.id) {
          uuuu = int_butt_data[2]
        } else { uuuu = int_butt_data[1] }
        const tutu2 = await create_meme(uuuu, 0)
        sess.send(h.image(tutu2, 'image/jpg'))
        break;
        
      case "/wife":
        // 执行查看老婆命令
        return sess.execute('wife')
    }
  })

  /**
   * 获取用户的老婆信息
   * 
   * @param session - Koishi会话对象
   * @returns 配对信息对象，或false（未配对）
   */
  async function get_user_wife(session) {
    // 从数据库获取当前群的配对数据
    let wife_data: qqwaifu_db_marry[] = await ctx.database.get("qqwaifu_db_marry", session.channelId)
    
    // 如果没有配对数据
    if (wife_data.length == 0) {
      return false
    } else {
      // 查找当前用户的配对对象
      const wifesss = wife_data[0].pairings[session.event.user.id]
      if (wifesss) {
        return {
          id: session.event.user.id,
          id2: wifesss
        }
      } else {
        return false
      }
    }
  }

  /**
   * 构建Markdown消息内容和键盘按钮
   * 生成完整的消息卡片
   * 
   * @param opti - 是否@对方
   * @param wife - 配对信息
   * @param session - Koishi会话对象
   * @returns 完整的消息对象
   */
  function send_md(opti: boolean, wife: { id: string, id2: string }, session) {
    let usid
    let uurl
    
    // 处理机器人配对情况
    if (wife.id2 == "bots") {
      usid = bots_ass.id
      uurl = bots_ass.url
    } else {
      usid = wife.id2
      // 生成QQ头像URL
      uurl = `https://q.qlogo.cn/qqapp/${session.bot.config.id}/${wife.id2}/640`
    }

    // 构建Markdown消息
    let mdp = {
      msg_type: 2,
      event_id: session.event._data.id,
      markdown: {
        content: "<qqbot-at-user id='"
          + session.event.user.id +
          "' />\n" +
          "💓您今天的老婆群友是：\n" +
          "![img #100px #100px](" + uurl + ")"
      },
    }

    // 处理消息ID
    let mess_id = session.messageId ? session.messageId : session.event._data.id
    if (session.messageId) {
      delete mdp.event_id;
      mdp['msg_id'] = mess_id
    }

    // 如果选择不@对方，修改消息内容
    if (opti == false) {
      mdp.markdown = {
        content: `<qqbot-at-user id="${wife.id}" />
💓您今天的老婆群友是：
<qqbot-at-user id="${usid}" />
![img #100px #100px](${uurl})`
      }
    }

    // 构建键盘按钮
    mdp['keyboard'] = {
      content: {
        rows: [
          {
            buttons: [
              {
                // 按钮1：看看我的（@对方）
                render_data: { label: "看看我的", visited_label: "🟢看看你的", style: 1 },
                action: {
                  type: 1, // 指令按钮
                  permission: { type: 2 },
                  data: `/wife`,
                },
              },
              {
                // 按钮2：（不@对方）看看我的
                render_data: { label: "(不@对方)看看我的", visited_label: "🟢看看你的", style: 1 },
                action: {
                  type: 2, // 指令按钮
                  permission: { type: 2 },
                  data: `/wife -n`,
                  enter: true
                },
              },
            ],
          },
          {
            buttons: [
              {
                // 按钮3：摸摸头
                render_data: { label: "摸摸头", visited_label: "🟢摸摸头", style: 1 },
                action: {
                  type: 1,
                  permission: {
                    type: 0,
                    specify_user_ids: [session.event.user.id, wife.id2]
                  },
                  data: `meme-momotou ${wife.id2} ${session.event.user.id}`
                },
              },
              {
                // 按钮4：结婚证
                render_data: { label: "结昏证🩷", visited_label: "🟢🩷🩷🩷", style: 1 },
                action: {
                  type: 1,
                  permission: {
                    type: 0,
                    specify_user_ids: [session.event.user.id, wife.id2]
                  },
                  data: `meme-jiehun ${wife.id2} ${session.event.user.id}`,
                },
              },
            ],
          },
        ],
      },
    }
    return mdp
  }

  /**
   * 生成表情包图片
   * 调用外部API生成趣味图片
   * 
   * @param userid - 用户ID
   * @param type - 图片类型：0=摸头, 1=结婚, 2=小丑, 3=离婚
   * @returns 生成的图片数据
   */
  async function create_meme(userid: string, type: number) {
    let utext
    let json_opt = {}
    
    // 根据类型设置API参数
    switch (type) {
      case 0:
        utext = 'petpet'
        json_opt = { "user_infos": [], "circle": true }
        break;
      case 1:
        utext = 'marriage'
        json_opt = { "user_infos": [] }
        break;
      case 2:
        utext = "clown_mask"
        json_opt = { "mode": "behind" }
        break;
      case 3:
        utext = "divorce"
        json_opt = { "user_infos": [] }
    }
    
    // 获取用户头像
    let img_url
    if (userid == 'bots') {
      img_url = bots_ass.url
    } else {
      img_url = `https://q.qlogo.cn/qqapp/${config.bot_appId}/${userid}/640`
    }

    // 下载头像图片
    const uarry = await ctx.http.get(img_url);
    
    // 创建FormData用于文件上传
    const formData = new FormData();
    formData.append('images', new Blob([uarry]), 'image.png');
    formData.append('texts', '');
    formData.append('args', JSON.stringify(json_opt));
    
    // 调用表情包API生成图片
    const out = await ctx.http.post(`${config.meme_api}/memes/${utext}/`, formData);

    return out
  }

  // ============================================================================
  // 6. 命令定义
  // ============================================================================

  /**
   * 离婚命令
   * 解除当前配对关系
   */
  ctx.command("离婚")
    .action(async ({ session }) => {
      // 未配对时的提示消息
      const no_user_md = {
        msg_type: 2,
        msg_id: session.messageId,
        markdown: {
          content: '**呜呜，还没有配对**\n' +
            "***\n" +
            "> ➢ <qqbot-cmd-input text='/菜单' show='功能菜单～' reference='true' />\n"
        },
      }
      
      // 获取配对数据
      let wifes = await ctx.database.get("qqwaifu_db_marry", session.channelId)
      const user_data = (await ctx.database.get("qqwaifu_dbs", session.channelId))[0]
      let tutu2
      
      // 检查是否有配对数据
      if (wifes.length == 0) {
        session.qq.sendMessage(session.channelId, no_user_md)
        return
      } else {
        // 检查当前用户是否有配对
        if (wifes[0].pairings[session.event.user.id]) {
          // 获取配对对象ID
          const keys = wifes[0].pairings[session.event.user.id]
          // 生成离婚表情包
          tutu2 = await create_meme(keys, 3)
          
          // 双向解除配对关系
          const keys_1 = wifes[0].pairings[keys]
          const keys_2 = wifes[0].pairings[session.event.user.id]
          delete wifes[0].pairings[keys]
          delete wifes[0].pairings[session.event.user.id]
          
          // 更新用户状态为未配对
          const ind_u1 = user_data.guilds.findIndex(a => a.userid == keys_1)
          const ind_u2 = user_data.guilds.findIndex(a => a.userid == keys_2)

          // 保存到数据库
          await ctx.database.upsert("qqwaifu_db_marry", () => [{
            id: session.channelId,
            pairings: wifes[0].pairings
          }])
          user_data.guilds[ind_u1] = {
            ...user_data.guilds[ind_u1],
            status_u: false
          }
          user_data.guilds[ind_u2] = {
            ...user_data.guilds[ind_u2],
            status_u: false
          }
          await ctx.database.upsert("qqwaifu_dbs", () => [
            {
              id: session.event.guild?.id,
              guilds: user_data.guilds
            }
          ])
        } else {
          // 未配对
          session.qq.sendMessage(session.channelId, no_user_md)
          return
        }
      }
      // 发送离婚表情包
      session.send((h.image(tutu2, 'image/jpg')))
      return
    })

  /**
   * 查看老婆命令
   * 配对或查看今日老婆
   */
  let ii = 0
  ctx.command('wife')
    .option('notat', '-n 不@对方')
    .option("console", "-c")
    .action(async ({ session, options }) => {
      // 记录机器人信息
      bots_ass.id = session.bot.user.name
      bots_ass.url = session.bot.user.avatar
      console.log(ii++)
      
      // 无可用用户时的提示
      const no_user_md = {
        msg_type: 2,
        msg_id: session.messageId,
        markdown: {
          content: '**呜呜，没有潜在的老婆群友了，大家快来使用爱丽丝吧**\n' +
            "***\n" +
            "> ➢ <qqbot-cmd-input text='/菜单' show='功能菜单～' reference='true' />\n"
        },
      }
      
      // 先检查是否已有配对
      const wife_data = await get_user_wife(session)
      
      // 如果已有配对，直接显示
      if (wife_data) {
        let bools = options.notat ? true : false
        const mdt = send_md(bools, wife_data, session)
        session.qq.sendMessage(session.channelId, mdt)
        return
      }
      
      // 获取用户数据
      let user_data = (await ctx.database.get("qqwaifu_dbs", session.event.guild.id))[0]

      // 检查用户数据是否存在
      if (!(user_data?.guilds)) {
        session.qq.sendMessage(session.channelId, no_user_md)
        return
      } 
      // 检查是否有足够的用户（至少需要2个用户才能配对）
      else if (user_data.guilds.length <= 2) {
        session.qq.sendMessage(session.channelId, no_user_md)
        return
      }
      
      // 执行配对
      const wifes = await ga_user(user_data.guilds, session)
      let indx_udata_u1
      let indx_udata_u2
      
      // 如果配对失败
      if (wifes == false) {
        session.qq.sendMessage(session.channelId, no_user_md)
        return
      } else {
        // 记录配对用户的索引
        indx_udata_u1 = user_data.guilds.findIndex(i => wifes.userid == i.userid)
        indx_udata_u2 = user_data.guilds.findIndex(i => session.event.user.id == i.userid)
      }
      
      // 更新配对状态
      if (wifes.userid == 'bots') {
        // 与机器人配对，不需要特殊处理
      } else {
        user_data.guilds[indx_udata_u1] = {
          ...user_data.guilds[indx_udata_u1],
          status_u: true,
        }
      }
      user_data.guilds[indx_udata_u2] = {
        ...user_data.guilds[indx_udata_u2],
        status_u: true,
      }
      
      // 保存用户状态到数据库
      await ctx.database.upsert("qqwaifu_dbs", [{
        id: session.event.guild.id,
        guilds: user_data.guilds
      }])
      
      // 保存配对关系到数据库
      const guildId = session.event.guild.id;
      const userId = session.event.user.id;
      const wifeId = wifes.userid;
      const existingData = await ctx.database.get("qqwaifu_db_marry", guildId);
      let dataToUpdate;
      
      if (Array.isArray(existingData) && existingData.length > 0) {
        dataToUpdate = existingData[0];
      } else {
        dataToUpdate = { id: guildId, pairings: {} };
      }
      
      // 双向配对记录
      dataToUpdate.pairings[userId] = wifeId;
      if (wifeId == 'bots') {
        // 与机器人配对
      } else {
        dataToUpdate.pairings[wifeId] = userId;
      }

      ctx.database.upsert("qqwaifu_db_marry", [dataToUpdate]);
      
      // 发送配对结果消息
      let boolss = options.notat ? true : false
      const mdss = send_md(boolss, { id: session.event.user.id, id2: wifes.userid }, session)
      await session.qq.sendMessage(session.channelId, mdss)
      return
    })

}
