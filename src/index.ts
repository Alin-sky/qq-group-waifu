/**
 * QQ群老婆配对插件
 * 
 * 功能说明：
 * - 每日随机为群成员配对"老婆"
 * - 支持结婚、离婚功能
 * - 生成趣味表情图（摸头、结婚等）
 * - 定时清理匹配数据
 * - 用户头像NSFW检测（基于NSFW.js本地检测，配对时触发）
 * 
 * @author Matrix Agent
 * @version 1.2.0
 */

// 导入 Koishi 框架核心模块
import { Context, h, Logger, Random, Schema } from 'koishi'

// 导入 QQ 适配器
import { } from '@satorijs/adapter-qq'

// 导入 NSFW.js 和 TensorFlow.js（用于本地NSFW检测）
import * as nsfwjs from 'nsfwjs'
import * as tf from '@tensorflow/tfjs-node'

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
  /** NSFW检测阈值（0-1），超过此值视为NSFW */
  nsfw_threshold?: number
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
  meme_api: Schema.string(),
  /** NSFW检测阈值（0-1），超过此值视为NSFW，默认0.5 */
  nsfw_threshold: Schema.number().min(0).max(1).step(0.1).default(0.5).description('NSFW检测阈值')
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
 * 声明自定义表：waifu_dbs（用户数据）、waifu_marriage（配对数据）
 */
declare module 'koishi' {
  interface Tables {
    /** 用户数据库 - 存储群成员状态信息 */
    waifu_dbs: WaifuDatabase
    /** 婚姻数据库 - 存储用户配对关系 */
    waifu_marriage: WaifuMarriage
  }
}

/**
 * 用户数据库结构
 * 记录每个群成员的状态信息
 */
export interface WaifuDatabase {
  /** 群ID（主键） */
  id: string
  /** 群成员列表 */
  members: GuildMember[]
}

/**
 * 单个群成员的数据结构
 */
export interface GuildMember {
  /** 用户ID */
  userId: string
  /** 配对状态：true=已配对，false=未配对 */
  isPaired: boolean
  /** 时间戳，记录用户最后活跃时间 */
  timestamp: number
  /** NSFW检测结果缓存 */
  nsfwScore?: number
  /** 头像是否已检测过NSFW */
  nsfwChecked?: boolean
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
export interface WaifuMarriage {
  /** 群ID（主键） */
  id: string
  /** 配对关系映射表 */
  pairings: Pairings;
}

/**
 * NSFW检测结果类型
 */
interface NsfwResult {
  /** 是否检测到NSFW内容 */
  isNsfw: boolean
  /** NSFW置信度分数（0-1） */
  score: number
  /** 详细预测结果 */
  predictions?: NsfwPrediction[]
  /** 错误信息（如果有） */
  error?: string
}

/**
 * NSFW预测结果
 */
interface NsfwPrediction {
  /** 类别名称 */
  className: string
  /** 置信度 */
  probability: number
}

/**
 * Markdown消息格式类型
 * 用于发送富文本消息
 */
type MarkdownFormat = {
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
// NSFW检测模块（基于NSFW.js）
// ============================================================================

/**
 * NSFW检测器类
 * 使用 NSFW.js 在本地进行图片检测
 * 在配对时触发检测，而非用户发消息时就检测
 */
class NsfwDetector {
  private threshold: number
  private logger: Logger
  private model: any = null
  private modelLoaded: boolean = false
  private loadingPromise: Promise<void> | null = null
  
  /** 缓存检测结果，避免重复检测 */
  private cache: Map<string, NsfwResult> = new Map()
  /** 检测中的请求，防止并发检测同一用户 */
  private pending: Map<string, Promise<NsfwResult>> = new Map()

  constructor(config: Config, logger: Logger) {
    this.threshold = config.nsfw_threshold || 0.5
    this.logger = logger
  }

  /**
   * 异步加载NSFW模型
   * 首次需要检测时自动调用
   */
  async ensureModelLoaded(): Promise<void> {
    // 如果模型已加载，直接返回
    if (this.modelLoaded && this.model) {
      return
    }

    // 如果正在加载，等待加载完成
    if (this.loadingPromise) {
      return this.loadingPromise
    }

    // 开始加载模型
    this.loadingPromise = this.doLoadModel()
    
    try {
      await this.loadingPromise
      this.modelLoaded = true
      this.logger.info('NSFW模型加载成功')
    } catch (error) {
      this.logger.error(`NSFW模型加载失败: ${error}`)
      this.loadingPromise = null
      throw error
    }
  }

  /**
   * 执行模型加载
   */
  private async doLoadModel(): Promise<void> {
    try {
      this.logger.info('正在加载NSFW模型，请稍候...')
      
      // 启用TensorFlow.js生产模式以提升性能
      tf.enableProdMode()
      
      // 加载NSFW.js模型
      this.model = await nsfwjs.load()
      
      this.logger.info('NSFW模型加载完成')
    } catch (error) {
      this.logger.error(`加载NSFW模型时出错: ${error}`)
      throw error
    }
  }

  /**
   * 检测图片是否为NSFW
   * 
   * @param imageBuffer - 图片Buffer数据
   * @returns NSFW检测结果
   */
  async detect(imageBuffer: Buffer): Promise<NsfwResult> {
    // 确保模型已加载
    await this.ensureModelLoaded()

    // 如果模型加载失败
    if (!this.model) {
      return { 
        isNsfw: false, 
        score: 0, 
        error: 'NSFW模型未加载' 
      }
    }

    try {
      // 将Buffer转换为TensorFlow.js支持的图片格式
      const imageTensor = tf.node.decodeImage(imageBuffer, 3)
      
      // 使用NSFW.js进行分类
      const predictions = await this.model.classify(imageTensor)
      
      // 释放TensorFlow.js内存
      imageTensor.dispose()

      // 计算NSFW分数（综合Hentai、Porn、Sexy类别的最高分数）
      let maxNsfwScore = 0
      const nsfwCategories = ['Hentai', 'Porn', 'Sexy']
      const detailedPredictions: NsfwPrediction[] = predictions.map((p: any) => ({
        className: p.className,
        probability: p.probability
      }))

      for (const pred of predictions) {
        if (nsfwCategories.includes(pred.className)) {
          if (pred.probability > maxNsfwScore) {
            maxNsfwScore = pred.probability
          }
        }
      }

      const isNsfw = maxNsfwScore > this.threshold

      this.logger.info(`NSFW检测完成: score=${maxNsfwScore.toFixed(4)}, isNsfw=${isNsfw}`)

      return {
        isNsfw,
        score: maxNsfwScore,
        predictions: detailedPredictions
      }
    } catch (error) {
      this.logger.error(`NSFW检测失败: ${error}`)
      return {
        isNsfw: false,
        score: 0,
        error: String(error)
      }
    }
  }

  /**
   * 通过URL检测图片
   * 
   * @param imageUrl - 图片URL
   * @returns NSFW检测结果
   */
  async detectFromUrl(imageUrl: string): Promise<NsfwResult> {
    // 检查缓存
    const cached = this.cache.get(imageUrl)
    if (cached) {
      return cached
    }

    // 检查是否有正在进行的检测
    const pending = this.pending.get(imageUrl)
    if (pending) {
      return pending
    }

    // 创建检测Promise并加入pending
    const detectPromise = this.doDetectFromUrl(imageUrl)
    this.pending.set(imageUrl, detectPromise)

    try {
      const result = await detectPromise
// 缓存结果
      this.cache.set(imageUrl, result)
      return result
    } finally {
      this.pending.delete(imageUrl)
    }
  }

  /**
   * 执行URL图片检测
   */
  private async doDetectFromUrl(imageUrl: string): Promise<NsfwResult> {
    try {
      this.logger.info(`正在检测头像: ${imageUrl}`)

      // 下载图片
      const response = await tf.fetch(imageUrl)
      const arrayBuffer = await response.arrayBuffer()
      const imageBuffer = Buffer.from(arrayBuffer)

      // 检测图片
      return await this.detect(imageBuffer)
    } catch (error) {
      this.logger.error(`从URL检测图片失败: ${error}`)
      return {
        isNsfw: false,
        score: 0,
        error: String(error)
      }
    }
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * 检查模型是否已加载
   */
  isModelLoaded(): boolean {
    return this.modelLoaded
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
 * @param markdownMessage - Markdown消息格式
 */
export async function sendMarkdownMessage(session, markdownMessage: MarkdownFormat) {
  try {
    // 判断平台类型
    if (session.event.platform == 'qq') {
      // 判断是否为群聊还是私聊
      if (session.event.guild) {
        // 群聊消息发送
        await session.qq.sendMessage(session.channelId, markdownMessage)
      } else {
        // 私聊消息发送
        await session.qq.sendPrivateMessage(session.event.user.id, markdownMessage)
      }
    } else if (session.event.platform == 'qqguild') {
      // QQ频道消息发送
      await session.qqguild.sendMessage(session.event.channel.id, markdownMessage)
    }
  } catch (error) {
    console.error('发送消息失败:', error)
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
   * 表名：waifu_dbs
   * 字段：id（群ID）, members（群成员列表，JSON格式）
   */
  ctx.model.extend('waifu_dbs', {
    id: "string",
    members: "json",
  })
  
  /**
   * 创建婚姻配对表
   * 表名：waifu_marriage
   * 字段：id（群ID）, pairings（配对关系，JSON格式）
   */
  ctx.model.extend('waifu_marriage', {
    id: "string",
    pairings: "json"
  })

  // 初始化日志记录器
  const loggerName = "qq-guild-waifu"
  const logger: Logger = new Logger(loggerName)
  
  // 初始化随机数生成器
  const random = new Random(() => Math.random())

  // 机器人信息存储（用于配对到机器人时使用）
  const botInfo = {
    id: '',
    avatar: ''
  }

  // -------------------------------------------------------------------------
  // 2. NSFW检测器初始化（基于NSFW.js，默认启用）
  // -------------------------------------------------------------------------
  
  /**
   * 初始化NSFW检测器
   * 模型会在首次配对时自动加载
   */
  const nsfwDetector = new NsfwDetector(config, logger)
  logger.info('NSFW检测模块已初始化，将在配对时自动检测头像')

  // -------------------------------------------------------------------------
  // 3. 定时任务调度
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
  async function clearAllMarriages(): Promise<void> {
    logger.info("执行每日清理任务，当前时间：", new Date());
    // 清空配对表
    await ctx.database.remove("waifu_marriage", {})
    logger.info("配对数据已清空")
    
    // 同时清除NSFW检测缓存
    nsfwDetector.clearCache()
    logger.info("NSFW检测缓存已清除")
  }

  // 启动定时任务（每日午夜清理配对数据）
  await scheduleMidnightTask(clearAllMarriages);

  // -------------------------------------------------------------------------
  // 4. 用户数据管理
  // -------------------------------------------------------------------------

  /**
   * 生成用户头像URL
   * 
   * @param userId - 用户ID
   * @returns 头像URL
   */
  function getAvatarUrl(userId: string): string {
    return `https://q.qlogo.cn/qqapp/${config.bot_appId}/${userId}/640`
  }

  /**
   * 检测用户头像是否为NSFW（基于NSFW.js，在配对时调用）
   * 
   * @param userId - 用户ID
   * @returns NSFW检测结果
   */
  async function checkUserAvatarNsfw(userId: string): Promise<NsfwResult> {
    const avatarUrl = getAvatarUrl(userId)
    return await nsfwDetector.detectFromUrl(avatarUrl)
  }

  /**
   * 保存/更新用户数据
   * 当用户首次使用或每次使用时更新其时间戳
   * 不进行NSFW检测，检测在配对时进行
   * 
   * @param session - Koishi会话对象
   */
  async function saveUser(session: any): Promise<void> {
    // 从数据库获取当前群的用户数据
    const guildData = (await ctx.database.get("waifu_dbs", session.event.guild?.id))
    // 计算刷新时间点（当天的config.hours点）
    const refreshTime = new Date().setHours(config.hours, 0, 0, 0)
    let memberData: GuildMember
    
    // 情况1：群数据为空，创建新记录
    if (guildData.length == 0) {
      await ctx.database.upsert('waifu_dbs', () => [
        {
          id: session.event.guild.id,
          members: [
            {
              userId: session.event.user.id,
              isPaired: false,
              timestamp: refreshTime,
              nsfwScore: 0,
              nsfwChecked: false  // 初始为false，配对时再检测
            },
            {
              userId: "bot",  // 保留机器人位置，用于与机器人配对
              isPaired: false,
              timestamp: 17000000000000,
              nsfwScore: 0,
              nsfwChecked: true
            },
          ],
        }
      ])
    } 
    // 情况2：用户已有记录，检查是否需要更新
    else if ((guildData[0].members).find(member => member.userId == session.event.user.id)) {
      const memberIndex = guildData[0].members.findIndex(member => member.userId == session.event.user.id)
      const existingMember = guildData[0].members[memberIndex]
      
      // 如果新的刷新时间晚于记录时间，更新时间戳并重置配对状态
      if (refreshTime > existingMember.timestamp) {
        memberData = {
          userId: session.event.user.id,
          isPaired: false,
          timestamp: refreshTime,
          nsfwScore: existingMember.nsfwScore || 0,
          nsfwChecked: existingMember.nsfwChecked || false
        }
        guildData[0].members[memberIndex] = memberData
      } 
      // 如果在同一天，只更新时间戳，保持配对状态
      else if (refreshTime <= existingMember.timestamp) {
        memberData = {
          userId: session.event.user.id,
          isPaired: existingMember.isPaired,
          timestamp: refreshTime,
          nsfwScore: existingMember.nsfwScore || 0,
          nsfwChecked: existingMember.nsfwChecked || false
        }
        guildData[0].members[memberIndex] = memberData
      }
      // 更新到数据库
      await ctx.database.upsert('waifu_dbs', () => [
        {
          id: session.event.guild.id,
          members: guildData[0].members,
        }
      ])
    } 
    // 情况3：新用户加入，追加到群用户列表
    else {
      memberData = {
        userId: session.event.user.id,
        isPaired: false,
        timestamp: refreshTime,
        nsfwScore: 0,
        nsfwChecked: false  // 配对时再检测
      };
      (guildData[0].members).push(memberData)

      try {
        await ctx.database.upsert('waifu_dbs', () => [
          {
            id: session.event.guild?.id,
            members: guildData[0].members,
          }
        ])
      } catch (error) {
        logger.error('保存用户数据失败:', error)
        return
      }
    }
  }

  /**
   * 获取可配对的群成员
   * 根据用户活跃时间和配对状态筛选可用用户
   * 在配对时触发NSFW检测
   * 
   * @param members - 群成员列表
   * @param session - Koishi会话对象
   * @returns 配对成功的用户对象，或null（无可配对用户）
   */
  async function getAvailablePartner(members: GuildMember[], session: any): Promise<GuildMember | null> {
    // 获取当天刷新时间点
    const refreshTime = new Date().setHours(config.hours, 0, 0, 0)
    const dayInMilliseconds = 86400000
    const expirationThreshold = config.days * dayInMilliseconds

    // 遍历所有群成员
    for (let i = 0; i < members.length; i++) {
      // 计算距离上次刷新的时间差
      const timeDiff = refreshTime - (members[i].timestamp)
      
      // 如果超过配置的天数，移除该用户
      if (timeDiff >= expirationThreshold) {
        members.splice(i, 1)
      } 
      // 如果在配置天数内但不为0，重置其配对状态为未配对
      else if (timeDiff < expirationThreshold && timeDiff != 0) {
        members[i].isPaired = false
      }
    }
    
    // 筛选出未配对的用户
    let availableUsers = members.filter(member => member.isPaired === false)
    
    // 在配对时进行NSFW检测，过滤掉NSFW头像的用户
    const safeUsers: GuildMember[] = []
    for (const user of availableUsers) {
      // 跳过机器人
      if (user.userId === 'bot') {
        safeUsers.push(user)
        continue
      }
      
      // 如果用户头像未检测过，进行NSFW检测
      if (!user.nsfwChecked) {
        try {
          const nsfwResult = await checkUserAvatarNsfw(user.userId)
          user.nsfwScore = nsfwResult.score
          user.nsfwChecked = true
          
          if (nsfwResult.isNsfw) {
            logger.info(`用户 ${user.userId} 因NSFW头像被排除，分数: ${nsfwResult.score.toFixed(4)}`)
            continue  // 跳过此用户
          }
        } catch (error) {
          // 检测失败时记录错误但继续使用该用户
          logger.error(`检测用户 ${user.userId} 头像失败: ${error}`)
          user.nsfwChecked = true  // 标记为已检测，避免重复检测
        }
      }
      
      // 如果已检测且分数超过阈值，排除该用户
      if (user.nsfwChecked && user.nsfwScore && user.nsfwScore > (config.nsfw_threshold || 0.5)) {
        logger.info(`用户 ${user.userId} 因NSFW头像被排除，分数: ${user.nsfwScore.toFixed(4)}`)
        continue  // 跳过此用户
      }
      
      safeUsers.push(user)
    }
    availableUsers = safeUsers
    
    // 排除自己
    const finalAvailableUsers = availableUsers.filter(member => member.userId != session.event.user.id)
    
    // 更新数据库（包含NSFW检测结果）
    ctx.database.upsert("waifu_dbs", [{
      id: session.event.guild.id,
      members: members
    }])

    // 如果没有可配对用户，返回null
    if (finalAvailableUsers.length == 0) {
      return null
    } else {
      // 随机选择一个用户作为"老婆"
      const partner = random.pick(finalAvailableUsers)
      return partner
    }
  }

  // -------------------------------------------------------------------------
  // 5. 中间件处理
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
      // 保存用户数据（不进行NSFW检测，检测在配对时进行）
      await saveUser(session)
      return next()
    }
  }, true)

  // -------------------------------------------------------------------------
  // 6. 按钮交互处理
  // -------------------------------------------------------------------------

  /**
   * 表情包类型枚举
   */
  enum MemeType {
    PetPet = 0,    // 摸头
    Marriage = 1,   // 结婚
    Clown = 2,     // 小丑
    Divorce = 3     // 离婚
  }

  /**
   * 处理按钮交互事件
   * 包括：结婚证、摸头、查看菜单等按钮
   */
  ctx.on("interaction/button", async (session: any) => {
    // 先保存用户数据
    await saveUser(session)
    
    // 解析按钮数据（格式："操作名 参数1 参数2"）
    const buttonData = session.event.button['data'].split(' ')
    
    // 根据操作类型处理
switch (buttonData[0]) {
      case 'meme-jiehun':
        // 生成结婚证图片
        let targetUserId: string
        // 判断是本人还是对方
        if (buttonData[1] == session.event.user.id) {
          targetUserId = buttonData[2]
        } else { 
          targetUserId = buttonData[1] 
        }
        const marriageMeme = await generateMemeImage(targetUserId, MemeType.Marriage)
        session.send(h.image(marriageMeme, 'image/jpg'))
        break;
        
      case "meme-momotou":
        // 生成摸头图片
        let petUserId: string
        if (buttonData[1] == session.event.user.id) {
          petUserId = buttonData[2]
        } else { 
          petUserId = buttonData[1] 
        }
        const petMeme = await generateMemeImage(petUserId, MemeType.PetPet)
        session.send(h.image(petMeme, 'image/jpg'))
        break;
        
      case "/wife":
        // 执行查看老婆命令
        return session.execute('wife')
    }
  })

  /**
   * 获取用户的老婆信息
   * 
   * @param session - Koishi会话对象
   * @returns 配对信息对象，或null（未配对）
   */
  async function getUserPartner(session: any): Promise<{ userId: string, partnerId: string } | null> {
    // 从数据库获取当前群的配对数据
    const marriageData: WaifuMarriage[] = await ctx.database.get("waifu_marriage", session.channelId)
    
    // 如果没有配对数据
    if (marriageData.length == 0) {
      return null
    } else {
      // 查找当前用户的配对对象
      const partnerId = marriageData[0].pairings[session.event.user.id]
      if (partnerId) {
        return {
          userId: session.event.user.id,
          partnerId: partnerId
        }
      } else {
        return null
      }
    }
  }

  /**
   * 构建Markdown消息内容和键盘按钮
   * 生成完整的消息卡片
   * 
   * @param shouldNotAt - 是否@对方
   * @param partnerInfo - 配对信息
   * @param session - Koishi会话对象
   * @returns 完整的消息对象
   */
  function buildMessage(shouldNotAt: boolean, partnerInfo: { userId: string, partnerId: string }, session: any): any {
    let partnerUserId: string
    let partnerAvatarUrl: string
    
    // 处理机器人配对情况
    if (partnerInfo.partnerId == "bot") {
      partnerUserId = botInfo.id
      partnerAvatarUrl = botInfo.avatar
    } else {
      partnerUserId = partnerInfo.partnerId
      // 生成QQ头像URL
      partnerAvatarUrl = getAvatarUrl(partnerInfo.partnerId)
    }

    // 构建Markdown消息
    let messagePayload: any = {
      msg_type: 2,
      event_id: session.event._data.id,
      markdown: {
        content: "<qqbot-at-user id='"
          + session.event.user.id +
          "' />\n" +
          "💓您今天的老婆群友是：\n" +
          "![img #100px #100px](" + partnerAvatarUrl + ")"
      },
    }

    // 处理消息ID
    let messageId = session.messageId ? session.messageId : session.event._data.id
    if (session.messageId) {
      delete messagePayload.event_id;
      messagePayload['msg_id'] = messageId
    }

    // 如果选择不@对方，修改消息内容
    if (shouldNotAt == false) {
      messagePayload.markdown = {
        content: `<qqbot-at-user id="${partnerInfo.userId}" />
💓您今天的老婆群友是：
<qqbot-at-user id="${partnerUserId}" />
![img #100px #100px](${partnerAvatarUrl})`
      }
    }

    // 构建键盘按钮
    messagePayload['keyboard'] = {
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
                    specify_user_ids: [session.event.user.id, partnerInfo.partnerId]
                  },
                  data: `meme-momotou ${partnerInfo.partnerId} ${session.event.user.id}`
                },
              },
              {
                // 按钮4：结婚证
                render_data: { label: "结昏证🩷", visited_label: "🟢🩷🩷🩷", style: 1 },
                action: {
                  type: 1,
                  permission: {
                    type: 0,
                    specify_user_ids: [session.event.user.id, partnerInfo.partnerId]
                  },
                  data: `meme-jiehun ${partnerInfo.partnerId} ${session.event.user.id}`,
                },
              },
            ],
          },
        ],
      },
    }
    return messagePayload
  }

  /**
   * 生成表情包图片
   * 调用外部API生成趣味图片
   * 
   * @param userId - 用户ID
   * @param memeType - 图片类型枚举
   * @returns 生成的图片数据
   */
  async function generateMemeImage(userId: string, memeType: MemeType): Promise<any> {
    let memeTypeText: string
    let memeOptions: Record<string, any> = {}
    
    // 根据类型设置API参数
    switch (memeType) {
      case MemeType.PetPet:
        memeTypeText = 'petpet'
        memeOptions = { "user_infos": [], "circle": true }
        break;
      case MemeType.Marriage:
        memeTypeText = 'marriage'
        memeOptions = { "user_infos": [] }
        break;
      case MemeType.Clown:
        memeTypeText = "clown_mask"
        memeOptions = { "mode": "behind" }
        break;
      case MemeType.Divorce:
        memeTypeText = "divorce"
        memeOptions = { "user_infos": [] }
    }
    
    // 获取用户头像
    let avatarUrl: string
    if (userId == 'bot') {
      avatarUrl = botInfo.avatar
    } else {
      avatarUrl = getAvatarUrl(userId)
    }

    // 下载头像图片
    const avatarData = await ctx.http.get(avatarUrl);
    
    // 创建FormData用于文件上传
    const requestFormData = new FormData();
    requestFormData.append('images', new Blob([avatarData]), 'image.png');
    requestFormData.append('texts', '');
    requestFormData.append('args', JSON.stringify(memeOptions));
    
    // 调用表情包API生成图片
    const memeResult = await ctx.http.post(`${config.meme_api}/memes/${memeTypeText}/`, requestFormData);

    return memeResult
  }

  // ============================================================================
  // 7. 命令定义
  // ============================================================================

  /**
   * 离婚命令
   * 解除当前配对关系
   */
  ctx.command("离婚")
    .action(async ({ session }) => {
      // 未配对时的提示消息
      const noMatchMessage = {
        msg_type: 2,
        msg_id: session.messageId,
        markdown: {
          content: '**呜呜，还没有配对**\n' +
            "***\n" +
            "> ➢ <qqbot-cmd-input text='/菜单' show='功能菜单～' reference='true' />\n"
        },
      }
      
      // 获取配对数据
      let marriages = await ctx.database.get("waifu_marriage", session.channelId)
      const guildData = (await ctx.database.get("waifu_dbs", session.channelId))[0]
      let divorceMeme: any
      
      // 检查是否有配对数据
      if (marriages.length == 0) {
        session.qq.sendMessage(session.channelId, noMatchMessage)
        return
      } else {
        // 检查当前用户是否有配对
        if (marriages[0].pairings[session.event.user.id]) {
          // 获取配对对象ID
          const partnerId = marriages[0].pairings[session.event.user.id]
          // 生成离婚表情包
          divorceMeme = await generateMemeImage(partnerId, MemeType.Divorce)
          
          // 双向解除配对关系
          const user1Id = marriages[0].pairings[partnerId]
          const user2Id = marriages[0].pairings[session.event.user.id]
          delete marriages[0].pairings[partnerId]
          delete marriages[0].pairings[session.event.user.id]
          
          // 更新用户状态为未配对
          const user1Index = guildData.members.findIndex(member => member.userId == user1Id)
          const user2Index = guildData.members.findIndex(member => member.userId == user2Id)

          // 保存到数据库
          await ctx.database.upsert("waifu_marriage", () => [{
            id: session.channelId,
            pairings: marriages[0].pairings
          }])
          
          if (user1Index !== -1) {
            guildData.members[user1Index] = {
              ...guildData.members[user1Index],
              isPaired: false
            }
          }
          if (user2Index !== -1) {
            guildData.members[user2Index] = {
              ...guildData.members[user2Index],
              isPaired: false
            }
          }
          await ctx.database.upsert("waifu_dbs", () => [
            {
              id: session.event.guild?.id,
              members: guildData.members
            }
          ])
        } else {
          // 未配对
          session.qq.sendMessage(session.channelId, noMatchMessage)
          return
        }
      }
      // 发送离婚表情包
      session.send((h.image(divorceMeme, 'image/jpg')))
      return
    })

  /**
   * 查看老婆命令
   * 配对或查看今日老婆（此时触发NSFW检测）
   */
  ctx.command('wife')
    .option('notat', '-n 不@对方')
    .option("console", "-c")
    .action(async ({ session, options }) => {
      // 记录机器人信息
      botInfo.id = session.bot.user.name
      botInfo.avatar = session.bot.user.avatar
      
      // 无可用用户时的提示
      const noMatchMessage = {
        msg_type: 2,
        msg_id: session.messageId,
        markdown: {
          content: '**呜呜，没有潜在的老婆群友了，大家快来使用爱丽丝吧**\n' +
            "***\n" +
            "> ➢ <qqbot-cmd-input text='/菜单' show='功能菜单～' reference='true' />\n"
        },
      }
      
      // 先检查是否已有配对
      const existingPartner = await getUserPartner(session)
      
      // 如果已有配对，直接显示
      if (existingPartner) {
        const shouldNotAt = options.notat ? true : false
        const messagePayload = buildMessage(shouldNotAt, existingPartner, session)
        session.qq.sendMessage(session.channelId, messagePayload)
        return
      }
      
      // 获取用户数据
      let guildData = (await ctx.database.get("waifu_dbs", session.event.guild.id))[0]

      // 检查用户数据是否存在
      if (!(guildData?.members)) {
        session.qq.sendMessage(session.channelId, noMatchMessage)
        return
      } 
      // 检查是否有足够的用户（至少需要2个用户才能配对）
      else if (guildData.members.length <= 2) {
        session.qq.sendMessage(session.channelId, noMatchMessage)
        return
      }
      
      // 执行配对（此时触发NSFW检测）
      const availablePartner = await getAvailablePartner(guildData.members, session)
      let partnerIndex: number
      let userIndex: number
      
      // 如果配对失败
      if (!availablePartner) {
        session.qq.sendMessage(session.channelId, noMatchMessage)
        return
      } else {
        // 记录配对用户的索引
        partnerIndex = guildData.members.findIndex(member => availablePartner.userId == member.userId)
        userIndex = guildData.members.findIndex(member => session.event.user.id == member.userId)
      }
      
      // 更新配对状态
      if (availablePartner.userId == 'bot') {
        // 与机器人配对，不需要特殊处理
      } else {
        guildData.members[partnerIndex] = {
          ...guildData.members[partnerIndex],
          isPaired: true,
        }
      }
      guildData.members[userIndex] = {
        ...guildData.members[userIndex],
        isPaired: true,
      }
      
      // 保存用户状态到数据库
      await ctx.database.upsert("waifu_dbs", [{
        id: session.event.guild.id,
        members: guildData.members
      }])
      
      // 保存配对关系到数据库
      const guildId = session.event.guild.id;
      const userId = session.event.user.id;
      const partnerId = availablePartner.userId;
      const existingData = await ctx.database.get("waifu_marriage", guildId);
      let dataToUpdate: WaifuMarriage;
      
      if (Array.isArray(existingData) && existingData.length > 0) {
        dataToUpdate = existingData[0];
      } else {
        dataToUpdate = { id: guildId, pairings: {} };
      }
      
      // 双向配对记录
      dataToUpdate.pairings[userId] = partnerId;
      if (partnerId == 'bot') {
        // 与机器人配对
      } else {
        dataToUpdate.pairings[partnerId] = userId;
      }

      ctx.database.upsert("waifu_marriage", [dataToUpdate]);
      
      // 发送配对结果消息
      const shouldNotAtResult = options.notat ? true : false
      const resultMessage = buildMessage(
        shouldNotAtResult, 
        { userId: session.event.user.id, partnerId: availablePartner.userId }, 
        session
      )
      await session.qq.sendMessage(session.channelId, resultMessage)
      return
    })

}
