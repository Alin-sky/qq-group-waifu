import { Context, Schema } from 'koishi'
import { } from "@koishijs/plugin-adapter-qq"
import { list } from './city'
export const name = 'tianqi'

export interface Config { }

export const Config: Schema<Config> = Schema.object({})





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


const url = 'https://restapi.amap.com/v3/weather/weatherInfo?'

const url22 = 'https://api.seniverse.com/v3/weather/hourly.json?key=S9JVYV-Xa4xXGnZxW&location=%E6%97%A7%E9%87%91%E5%B1%B1&language=zh-Hans&unit=c'

const url3 = 'https://uapis.cn/api/v1/misc/weather?city='
export async function apply(ctx: Context) {


  ////////鉴权器
  let bots = {
    appId: "102062652",//appid ,必填
    secret: "42qSq8BzY0DLI2Zr",//secret,必填
  };
  let bot_tok = {
    token: '',//获取到的token，string，乱填（）
    expiresIn: 31//过期时间，number，乱填（）
  }
  async function refreshToken(bot) {
    const { access_token: accessToken, expires_in: expiresIn } = await ctx.http.post('https://bots.qq.com/app/getAppAccessToken', {
      appId: bot.appId,
      clientSecret: bot.secret
    });
    bot_tok.token = accessToken;
    bot_tok.expiresIn = expiresIn
  }
  //await refreshToken(bots)//运行
  //console.log(bot_tok)//结果

  function findRegion(name: string): string | null {
    for (const region of list) {
      if (region.name.includes(name)) {
        return region.adcode;
      }
    }
    return null;
  }




  function getTimePeriod() {
    const currentHour = new Date().getHours();
    if (currentHour < 7 || currentHour >= 19) {
      return true;
    } else {
      return false;
    }
  }

  let arry = []
  let kmr = []
  ctx.command("天气 <message:text>")
    .action(async ({ session }, message) => {
      if (!message) {
        session.qq.sendMessage(session.channelId, {
          msg_id: session.messageId,
          msg_type: 2,
          markdown: {
            content: "<qqbot-at-user id='"
              + session.event.user.id +
              "' />\n" +
              "功能：查询国内天气 \n" +
              "使用示例：  ***@AL_1S /天气 上海***\n" +
              "> 点击下方蓝字快捷输入指令哦 \n" +
              "> <qqbot-cmd-input text='/天气 ' show='查询天气' reference='true' />"
          },
        })
        return
      }

      const adcode = findRegion(message);
      console.log(adcode)
      let mess
      const wdata = await ctx.http.get(`${url}city=${adcode}&key=8af03c75862877ae4cd4dcb00bbde02d`)
 //     console.log(wdata)
      if (true) {
        const wdatas = await ctx.http.get(`${url3}${message}&extended=true&indices=true&forecast=true`)
        console.log(wdatas)

        const match = wdatas.report_time
        console.log(match)
        let formatter = ''
        function formatCustomDateTime(input: string): string {
          const [datePart, timePart] = input.split(' ');
          const [year, month, day] = datePart.split('-').map(Number);
          const [hour, minute] = timePart.split(':').map(Number);

          return `${month}月${day}日${hour}点${minute}分`;
        }
        formatter = formatCustomDateTime(match)


        let aa = getTimePeriod() ? '🌃 ✨ 🌙 🌠 ' : '🏙️ 🌈 ☀️ ☁️'
        let kaze = ''
        switch (wdatas.wind_direction) {
          case '西风':
            kaze = '⬅️'
            break
          case '西北风':
            kaze = '↖️'
            break
          case '北风':
            kaze = '⬆️'
            break
          case '东北风':
            kaze = '↗️'
            break
          case '东风':
            kaze = '➡️'
            break
          case '东南风':
            kaze = '↘️'
            break
          case '南风':
            kaze = '⬇️'
            break
          case '西南风':
            kaze = '↙️'
            break
        }

        let wst = ''
        switch (wdatas.weather) {
          case '晴':
            wst = '☀️'
            break
          case '多云':
            wst = '⛅️'
            break
          case '中雨':
          case "小雨":
            wst = '🌧️'
            break
          case '阵雨':
            wst = '🌦️'
            break
          case '阴':
            wst = '☁️'
            break
          case '雾':
            wst = '🌁'
            break
          case '暴雨':
            wst = '🌧️🌧️🌧️'
            break
          case "中雨-大雨":
            wst = '🌧️-🌧️🌧️'
            break
          case "大雨-暴雨":
            wst = '🌧️🌧️-🌧️🌧️🌧️'
            break
          case "大雨":
            wst = '🌧️🌧️'
            break
          case "雷阵雨":
            wst = '⛈️'
            break
          case "冰雹":
            wst = '🧊'
            break
          case "雨夹雪":
            wst = '🌨️🌧️'
            break
          case "阵雪":
            wst = '🌨️'
            break
          case "小雪":
          case "中雪":
            wst = '🌨️'
            break
          case "大雪":
            wst = '🌨️🌨️'
            break
          case "暴雪":
            wst = '🌨️🌨️🌨️'
            break
        }

        let warns = wdatas.weather.includes('雨') ? '# ***☔️出门记得带伞哦~*** \n' : ''
        //let citys = wdata.lives[0].province == wdata.lives[0].city ? wdata.lives[0].city : wdata.lives[0].province + wdata.lives[0].city
        let at = "<qqbot-at-user id='" + session.event.user.id + "' />\n"
        console.log(session.event.guild)
        if (session.event.guild == undefined) {
          at = '\n'
        }
        function tem_color(temp) {
          if (temp <= 0) {
            return "❄️❄️❄️"
          } else if (temp > 0 && temp <= 15) {
            return "🟦🟦🟦"
          } else if (temp > 15 && temp <= 26) {
            return "🟩🟩🟩"
          } else if (temp > 26 && temp <= 34) {
            return "🟨🟨🟨"
          } else if (temp > 34 && temp <= 38) {
            return "🟧🟧🟧"
          } else if (temp > 38) {
            return "🟥🟥🟥🟥"
          }
        }
        let color_temp = tem_color(wdatas.temperature)
        let md: md_format = {
          msg_id: session.messageId,
          msg_type: 2,
          markdown: {
            content:
              at +
              "# " + aa + '\n' +
              wdatas.city + '\n' +
              "*** \n" +
              warns +
              "- 🕒当地预报时间：\n" + formatter + "\n" +
              "- 🌥️天气：" + wdatas.weather + "  " + wst + "\n" +
              "- 🌡️当前气温：" + wdatas.temperature + "℃\n" +
              ">" + color_temp + "\n" +
              "> 🔼最高气温：" + wdatas.temp_max + "℃\n" +
              "> 🔽最低气温：" + wdatas.temp_min + "℃\n" +
              "- 🎐当前风向：" + wdatas.wind_direction + kaze + "\n" +
              "- 🌬当前风力：" + wdatas.wind_power + " 级\n" +
              "- 💧降水概率：" + wdatas.precipitation + "%\n" +
              "- 💦空气湿度：" + wdatas.humidity + "%\n" +
              "<qqbot-cmd-input text='/天气 ' show='查询其他地区' reference='true' />"
          },
        }
        send_md_mess(session, md)
        return
      }



      if (wdata.lives.length == 0) {

        try {
          const wdatas = await ctx.http.get(`https://api.seniverse.com/v3/weather/hourly.json?key=SB-iYUXxBGhMI2DZl&location=${message}&language=zh-Hans&unit=c`)
          console.log(wdatas)
          if (!wdatas) {
            console.log(wdatas)
            session.qq.sendMessage(session.channelId, {
              msg_id: session.messageId,
              msg_type: 2,
              markdown: {
                content: "<qqbot-at-user id='"
                  + session.event.user.id +
                  "' />\n" +
                  "😿未找到该地区，请输入详细名称\n" +
                  "<qqbot-cmd-input text='/天气 ' show='重新查询' reference='true' />"
              },
            })
            return
          } else {
            let city = wdatas.results[0].location.path

            city = city.split(',').reverse().join('');
            console.log(city)
            let weaths = wdatas.results[0].hourly[1]
            console.log(weaths.time);

            const match = weaths.time.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);

            let formatter
            if (match) {
              const [, year, month, day, hour, minute] = match;
              // 格式化日期和时间为 "8月19日 18:00"
              const formattedDate = `${parseInt(month)}月${parseInt(day)}日 ${hour}:${minute}`;
              console.log(formattedDate);
              formatter = formattedDate
            } else {
              console.log('日期时间格式不正确');
            }



            let aa = getTimePeriod() ? '🌃 ✨ 🌙 🌠 ' : '🏙️ 🌈 ☀️ ☁️'
            let kaze = ''
            switch (weaths.wind_direction) {
              case '西':
                kaze = '⬅️'
                break
              case '西北':
                kaze = '↖️'
                break
              case '北':
                kaze = '⬆️'
                break
              case '东北':
                kaze = '↗️'
                break
              case '东':
                kaze = '➡️'
                break
              case '东南':
                kaze = '↘️'
                break
              case '南':
                kaze = '⬇️'
                break
              case '西南':
                kaze = '↙️'
                break
            }

            let wst = ''
            switch (weaths.weather) {
              case '晴':
                wst = '☀️'
                break
              case '多云':
                wst = '⛅️'
                break
              case '中雨':
              case "小雨":
                wst = '🌧️'
                break
              case '阵雨':
                wst = '🌦️'
                break
              case '阴':
                wst = '☁️'
                break
              case '雾':
                wst = '🌁'
                break
              case '暴雨':
                wst = '🌧️🌧️🌧️'
                break
              case "中雨-大雨":
                wst = '🌧️-🌧️🌧️'
                break
              case "大雨-暴雨":
                wst = '🌧️🌧️-🌧️🌧️🌧️'
                break
              case "大雨":
                wst = '🌧️🌧️'
                break
              case "雷阵雨":
                wst = '⛈️'
                break
              case "冰雹":
                wst = '🧊'
                break
              case "雨夹雪":
                wst = '🌨️🌧️'
                break
              case "阵雪":
                wst = '🌨️'
                break
              case "小雪":
              case "中雪":
                wst = '🌨️'
                break
              case "大雪":
                wst = '🌨️🌨️'
                break
              case "暴雪":
                wst = '🌨️🌨️🌨️'
                break
            }

            let warns = weaths.text.includes('雨') ? '- ☔️出门记得带伞哦~ \n' : ''
            //let citys = wdata.lives[0].province == wdata.lives[0].city ? wdata.lives[0].city : wdata.lives[0].province + wdata.lives[0].city

            session.qq.sendMessage(session.channelId, {
              msg_id: session.messageId,
              msg_type: 2,
              markdown: {
                content: "<qqbot-at-user id='"
                  + session.event.user.id +
                  "' />\n" +
                  "# " + aa + '\n' +
                  city + "\n" +
                  "*** \n" +
                  warns +
                  "- 🕒当地预报时间：" + formatter + "\n" +
                  "- 🌥️天气：" + weaths.text + "  " + wst + "\n" +
                  "- 🌡️当前气温：" + weaths.temperature + "℃\n" +
                  "- 🎐当前风向：" + weaths.wind_direction + kaze + "\n" +
                  "- 💨当前风速：" + weaths.wind_speed + " km/h\n" +
                  "- 💦空气湿度：" + weaths.humidity + "%\n" +
                  "\u200B\n" +
                  "<qqbot-cmd-input text='/天气 ' show='查询其他地区' reference='true' />"
              },


            })
          }


        } catch (e) {
          session.qq.sendMessage(session.channelId, {
            msg_id: session.messageId,
            msg_type: 2,
            markdown: {
              content: "<qqbot-at-user id='"
                + session.event.user.id +
                "' />\n" +
                "未查询到该地区/未查询到该地区天气\n" +
                "<qqbot-cmd-input text='/天气 ' show='重新查询' reference='true' />"
            },
          })
        }

        return
      } else {
        arry.push(wdata.lives[0].weather)

        let aa = getTimePeriod() ? '🌃 ✨ 🌙 🌠 ' : '🏙️ 🌈 ☀️ ☁️'
        let kaze
        switch (wdata.lives[0].winddirection) {
          case '西':
            kaze = '⬅️'
            break
          case '西北':
            kaze = '↖️'
            break
          case '北':
            kaze = '⬆️'
            break
          case '东北':
            kaze = '↗️'
            break
          case '东':
            kaze = '➡️'
            break
          case '东南':
            kaze = '↘️'
            break
          case '南':
            kaze = '⬇️'
            break
          case '西南':
            kaze = '↙️'
            break
        }

        let wst
        switch (wdata.lives[0].weather) {
          case '晴':
            wst = '☀️'
            break
          case '多云':
            wst = '⛅️'
            break
          case '中雨':
          case "小雨":
            wst = '🌧️'
            break
          case '阵雨':
            wst = '🌦️'
            break
          case '阴':
            wst = '☁️'
            break
          case '雾':
            wst = '🌁'
            break
          case '暴雨':
            wst = '🌧️🌧️🌧️'
            break
          case "大雨":
            wst = '🌧️🌧️'
            break
        }

        let warns = wdata.lives[0].weather.includes('雨') ? '- ☔️出门记得带伞哦~ \n' : ''
        let citys = wdata.lives[0].province == wdata.lives[0].city ? wdata.lives[0].city : wdata.lives[0].province + wdata.lives[0].city

        session.qq.sendMessage(session.channelId, {
          msg_id: session.messageId,
          msg_type: 2,
          markdown: {
            content: "<qqbot-at-user id='"
              + session.event.user.id +
              "' />\n" +
              "# " + aa + '\n' +
              citys + "\n" +
              "*** \n" +
              warns +
              "- 🌥️天气：" + wdata.lives[0].weather + "  " + wst + "\n" +
              "- 🌡️当前气温：" + wdata.lives[0].temperature + "℃\n" +
              "- 🎐当前风向：" + wdata.lives[0].winddirection + kaze + "\n" +
              "- 💨当前风力：" + wdata.lives[0].windpower + "\n" +
              "- 💦空气湿度：" + wdata.lives[0].humidity + "%\n" +
              "\u200B\n" +
              "<qqbot-cmd-input text='/天气 ' show='查询其他地区' reference='true' />"
          },
        })
      }

      async function sendMessage() {

        await refreshToken(bots)//刷新权限，配合鉴权器
        try {
          // 发送消息
          //api：	/v2/groups/{group_openid}/messages
          ///v2/groups/{group_openid}/files
          const messss: any = await ctx.http.post(`https://api.sgroup.qq.com/v2/groups/${session.guildId}/files`, mess,
            {
              headers: {
                Authorization: `QQBot ${bot_tok.token}`,
                'X-Union-Appid': bots.appId
              }
            }
          )
          console.log(messss)

        } catch (error) {
          console.error('媒体上传失败:', error);
        }
      }
      //sendMessage()







    })


  //console.log()

}
