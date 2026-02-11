import { Context, h, Logger, Random, Schema } from 'koishi'
import { } from '@satorijs/adapter-qq';
export const name = 'qq-group-waifu'
export interface Config {
  days: number
  hours: number
  meme_api: string
  bot_appId: string
}

export const Config: Schema<Config> = Schema.object({
  days: Schema.number().min(1).max(14).step(1).default(3).description('用户刷新频率，超过该时间的用户会被删除（单位：天）'),
  hours: Schema.number().min(0).max(24).step(1).default(0).description('数据刷新时间，24小时制'),
  bot_appId: Schema.string(),
  meme_api: Schema.string()
})

export const inject = { required: ['database'] }

declare module 'koishi' {
  interface Tables {
    qqwaifu_dbs: qqwaifu_dbs
    qqwaifu_db_marry: qqwaifu_db_marry
  }
}

export interface qqwaifu_dbs {
  id: string
  guilds: qqw_user_dbs[]
}
export interface qqw_user_dbs {
  userid: string
  status_u: boolean
  timestemp: number
}
export interface Pairings {
  [userId: string]: string;
}
export interface qqwaifu_db_marry {
  id: string
  pairings: Pairings;
}

type md_format = {
  msg_id?: string
  event_id?: string
  msg_type: number
  markdown: {
    content: any
  }
}
export async function send_md_mess(session, md: md_format) {
  try {
    if (session.event.platform == 'qq') {
      if (session.event.guild) {
        await session.qq.sendMessage(session.channelId, md)
      } else {
        await session.qq.sendPrivateMessage(session.event.user.id, md)
      }
    } else if (session.event.platform == 'qqguild') {
      await session.qqguild.sendMessage(session.event.channel.id, md)
    }
  } catch (e) {
    console.log(e)
  }
}

export async function apply(ctx: Context, config: Config) {

  ctx.model.extend('qqwaifu_dbs', {
    id: "string",
    guilds: "json",
  })
  ctx.model.extend('qqwaifu_db_marry', {
    id: "string",
    pairings: "json"
  })

  const log1 = "qq-guild-waifu"
  const log: Logger = new Logger(log1)
  const random = new Random(() => Math.random())

  const bots_ass = {
    id: '',
    url: ''
  }

  function scheduleMidnightTask(taskFunction: () => void): void {
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    const delay = nextMidnight.getTime() - now.getTime(); // 使用 getTime() 获取毫秒时间戳

    setTimeout(() => {
      taskFunction(); // 执行任务
      scheduleMidnightTask(taskFunction); // 重新调度任务
    }, delay);
  }

  async function delet_wifes(): Promise<void> {

    console.log("执行任务，当前时间：", new Date());
    await ctx.database.remove("qqwaifu_db_marry", {})
    console.log(await ctx.database.get("qqwaifu_db_marry", {}))
  }

  // 启动定时任务
  await scheduleMidnightTask(delet_wifes);

  //删除匹配信息
  //await delet_wifes()

  let i = 0
  async function save_user(session) {
    const user_data = (await ctx.database.get("qqwaifu_dbs", session.event.guild?.id))
    const etime = new Date().setHours(config.hours, 0, 0, 0)
    let indata: qqw_user_dbs
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
              userid: "bots",
              status_u: false,
              timestemp: 17000000000000//2508年
            },
          ],
        }
      ])
    } else if ((user_data[0].guilds).find(a => a.userid == session.event.user.id)) {
      //用户有记录
      const ind = user_data[0].guilds.findIndex(a => a.userid == session.event.user.id)
      if (etime > user_data[0].guilds[ind].timestemp) {
        indata = {
          userid: session.event.user.id,
          status_u: false,
          timestemp: etime
        }
        user_data[0].guilds[ind] = indata
      } else if (etime <= user_data[0].guilds[ind].timestemp) {
        indata = {
          userid: session.event.user.id,
          status_u: user_data[0].guilds[ind].status_u,
          timestemp: etime
        }
        user_data[0].guilds[ind] = indata
      }
      await ctx.database.upsert('qqwaifu_dbs', () => [
        {
          id: session.event.guild.id,
          guilds: user_data[0].guilds,
        }
      ])
    } else {
      //新用户
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


  async function ga_user(guild_users: qqw_user_dbs[], session) {
    const etime = new Date().setHours(config.hours, 0, 0, 0)

    for (let i = 0; i < guild_users.length; i++) {
      const calcula = etime - (guild_users[i].timestemp)
      if (calcula >= (config.days * 86400000)) {
        //console.log("删除")
        guild_users.splice(i, 1)
      } else if (calcula < (config.days * 86400000) && calcula != 0) {
        guild_users[i].status_u = false
      }
    }
    const l_1 = guild_users.filter((i) => i.status_u == false)
    const l_2 = l_1.filter(i => i.userid != session.event.user.id)
    ctx.database.upsert("qqwaifu_dbs", [{
      id: session.event.guild.id,
      guilds: guild_users
    }])

    if (l_2.length == 0) {
      return false
    } else {
      const wife = random.pick(l_2)
      return wife
    }
  }

  ctx.middleware(async (session, next) => {
    if (!session.event.guild) {
      return next()
    } else {
      await save_user(session)
      return next()
    }
  }, true)

  ctx.on("interaction/button", async sess => {

    await save_user(sess)
    const int_butt_data = sess.event.button['data'].split(' ')
    switch (int_butt_data[0]) {
      case 'meme-jiehun':
        let uuuuu
        if (int_butt_data[1] == sess.event.user.id) {
          uuuuu = int_butt_data[2]
        } else { uuuuu = int_butt_data[1] }
        const tutu = await create_meme(uuuuu, 1)
        sess.send(h.image(tutu, 'image/jpg'))
        break;
      case "meme-momotou":
        let uuuu
        if (int_butt_data[1] == sess.event.user.id) {
          uuuu = int_butt_data[2]
        } else { uuuu = int_butt_data[1] }
        const tutu2 = await create_meme(uuuu, 0)
        sess.send(h.image(tutu2, 'image/jpg'))
        break;
      case "/wife":
        return sess.execute('wife')
    }
  })


  async function get_user_wife(session) {
    let wife_data: qqwaifu_db_marry[] = await ctx.database.get("qqwaifu_db_marry", session.channelId)
    if (wife_data.length == 0) {
      return false
      // wife_data = await ctx.database.get("qqwaifu_db_marry", uid)
    } else {
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

  function send_md(opti: boolean, wife: { id: string, id2: string }, session) {

    let usid
    let uurl
    if (wife.id2 == "bots") {
      usid = bots_ass.id
      uurl = bots_ass.url
    } else {
      usid = wife.id2
      uurl = `https://q.qlogo.cn/qqapp/${session.bot.config.id}/${wife.id2}/640`
    }
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
    let mess_id = session.messageId ? session.messageId : session.event._data.id
    if (session.messageId) {
      delete mdp.event_id;
      mdp['msg_id'] = mess_id;
    }
    if (opti == false) {
      mdp.markdown = {
        content: `<qqbot-at-user id="${wife.id}" />
💓您今天的老婆群友是：
<qqbot-at-user id="${usid}" />
![img #100px #100px](${uurl})`
      }
    }

    mdp['keyboard'] = {
      content: {
        rows: [
          {
            buttons: [
              {
                render_data: { label: "看看我的", visited_label: "🟢看看你的", style: 1 },
                action: {
                  type: 1, // 指令按钮
                  permission: { type: 2 },
                  data: `/wife`,
                  //enter: true
                },
              },
              {
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
                render_data: { label: "摸摸头", visited_label: "🟢摸摸头", style: 1 },
                action: {
                  type: 1, // 指令按钮
                  permission: {
                    type: 0,
                    specify_user_ids: [session.event.user.id, wife.id2]
                  },
                  data: `meme-momotou ${wife.id2} ${session.event.user.id}`
                  //enter: true
                },
              },
              {
                render_data: { label: "结昏证🩷", visited_label: "🟢🩷🩷🩷", style: 1 },
                action: {
                  type: 1, // 指令按钮
                  permission: {
                    type: 0,
                    specify_user_ids: [session.event.user.id, wife.id2]
                  },
                  data: `meme-jiehun ${wife.id2} ${session.event.user.id}`,
                  //enter: true
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
   * 
   * @param userid 用户id
   * @param type 0 摸头 1结婚 2小丑 3离婚
   * @returns 
   */
  async function create_meme(userid: string, type: number) {
    let utext
    let json_opt = {}
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
    let img_url
    if (userid == 'bots') {
      img_url = bots_ass.url
    } else {
      img_url = `https://q.qlogo.cn/qqapp/${config.bot_appId}/${userid}/640`
    }

    const uarry = await ctx.http.get(img_url);
    // 创建一个 FormData 对象
    const formData = new FormData();
    formData.append('images', new Blob([uarry]), 'image.png'); // 使用 Blob 包装数据
    formData.append('texts', '');
    formData.append('args', JSON.stringify(json_opt));
    // 发送 POST 请求
    const out = await ctx.http.post(`${config.meme_api}/memes/${utext}/`, formData);

    function arrayBufferToBase64(buffer) {
      const uint8Array = new Uint8Array(buffer);
      const binaryString = uint8Array.reduce((data, byte) => data + String.fromCharCode(byte), '');
      return Buffer.from(binaryString, 'binary').toString('base64');
    }
    return out
  }

  /**
   *                    _ooOoo_
   *                   o8888888o
   *                   88" . "88
   *                   (| -_- |)
   *                    O\ = /O
   *                ____/`---'\____
   *              .   ' \\| |// `.
   *               / \\||| : |||// \
   *             / _||||| -:- |||||- \
   *               | | \\\ - /// | |
   *             | \_| ''\---/'' | |
   *              \ .-\__ `-` ___/-. /
   *           ___`. .' /--.--\ `. . __
   *        ."" '< `.___\_<|>_/___.' >'"".
   *       | | : `- \`.;`\ _ /`;.`/ - ` : | |
   *         \ \ `-. \_ __\ /__ _/ .-` / /
   * ======`-.____`-.___\_____/___.-`____.-'======
   *                    `=---='
   *
   * .............................................
   *          佛祖保佑             永无BUG
  */

  ctx.command("离婚")
    .action(async ({ session }) => {
      const no_user_md = {
        msg_type: 2,
        msg_id: session.messageId,
        markdown: {
          content: '**呜呜，还没有配对**\n' +
            "***\n" +
            "> ➢ <qqbot-cmd-input text='/菜单' show='功能菜单～' reference='true' />\n"
        },
      }
      let wifes = await ctx.database.get("qqwaifu_db_marry", session.channelId)
      const user_data = (await ctx.database.get("qqwaifu_dbs", session.channelId))[0]
      let tutu2
      if (wifes.length == 0) {
        session.qq.sendMessage(session.channelId, no_user_md)
        return //'呜呜，还没有配对'
      } else {
        if (wifes[0].pairings[session.event.user.id]) {
          const keys = wifes[0].pairings[session.event.user.id]
          tutu2 = await create_meme(keys, 3)
          const keys_1 = wifes[0].pairings[keys]
          const keys_2 = wifes[0].pairings[session.event.user.id]
          delete wifes[0].pairings[keys]
          delete wifes[0].pairings[session.event.user.id]
          const ind_u1 = user_data.guilds.findIndex(a => a.userid == keys_1)
          const ind_u2 = user_data.guilds.findIndex(a => a.userid == keys_2)

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
          session.qq.sendMessage(session.channelId, no_user_md)
          return //'呜呜，还没有配对'
        }
      }
      session.send((h.image(tutu2, 'image/jpg')))
      return
    })
  let ii = 0
  ctx.command('wife')
    .option('notat', '-n 不@对方')
    .option("console", "-c")
    .action(async ({ session, options }) => {
      bots_ass.id = session.bot.user.name
      bots_ass.url = session.bot.user.avatar
      console.log(ii++)
      const no_user_md = {
        msg_type: 2,
        msg_id: session.messageId,
        markdown: {
          content: '**呜呜，没有潜在的老婆群友了，大家快来使用爱丽丝吧**\n' +
            "***\n" +
            "> ➢ <qqbot-cmd-input text='/菜单' show='功能菜单～' reference='true' />\n"
        },
      }
      const wife_data = await get_user_wife(session)
      if (wife_data) {
        let bools = options.notat ? true : false
        const mdt = send_md(bools, wife_data, session)
        session.qq.sendMessage(session.channelId, mdt)
        return
      }
      let user_data = (await ctx.database.get("qqwaifu_dbs", session.event.guild.id))[0]

      if (!(user_data?.guilds)) {
        session.qq.sendMessage(session.channelId, no_user_md)
        return //'呜呜，爱丽丝还不熟悉大家，大家快来使用爱丽丝吧'
      } else if (user_data.guilds.length <= 2) {
        session.qq.sendMessage(session.channelId, no_user_md)
        return //'呜呜，爱丽丝还不熟悉大家，大家快来使用爱丽丝吧'
      }
      const wifes = await ga_user(user_data.guilds, session)
      let indx_udata_u1
      let indx_udata_u2
      if (wifes == false) {

        session.qq.sendMessage(session.channelId, no_user_md)
        return //'呜呜，没有潜在的老婆群友了，大家快来使用爱丽丝吧'
      } else {
        indx_udata_u1 = user_data.guilds.findIndex(i => wifes.userid == i.userid)
        indx_udata_u2 = user_data.guilds.findIndex(i => session.event.user.id == i.userid)
      }
      if (wifes.userid == 'bots') {

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
      await ctx.database.upsert("qqwaifu_dbs", [{
        id: session.event.guild.id,
        guilds: user_data.guilds
      }])
      const guildId = session.event.guild.id;
      const userId = session.event.user.id;
      const wifeId = wifes.userid;
      const existingData = await ctx.database.get("qqwaifu_db_marry", guildId);
      let dataToUpdate;
      if (Array.isArray(existingData) && existingData.length > 0) {
        dataToUpdate = existingData[0]; // 从数组中获取第一个对象
      } else {
        dataToUpdate = { id: guildId, pairings: {} };
      }
      dataToUpdate.pairings[userId] = wifeId;
      if (wifeId == 'bots') {

      } else {
        dataToUpdate.pairings[wifeId] = userId;
      }

      ctx.database.upsert("qqwaifu_db_marry", [dataToUpdate]);
      let boolss = options.notat ? true : false
      const mdss = send_md(boolss, { id: session.event.user.id, id2: wifes.userid }, session)
      await session.qq.sendMessage(session.channelId, mdss)
      return
    })

  //console.log(await ctx.database.get("qqwaifu_db_marry", '8D0D023DC8C413D85B7B93669DCF16CB'))
  //console.log((await ctx.database.get("qqwaifu_dbs", '8D0D023DC8C413D85B7B93669DCF16CB'))[0])


}
