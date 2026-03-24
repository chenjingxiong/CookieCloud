/**
 * CookieCloud 双向同步常量配置
 */

// 同步类型枚举
export enum SyncType {
  UP = 'up',           // 上传模式
  DOWN = 'down',       // 下载模式
  SYNC = 'sync',       // 双向同步模式
  PAUSE = 'pause'      // 暂停模式
}

// 合并策略枚举
export enum MergeStrategy {
  NEWEST = 'newest',   // 取最新的
  LOCAL = 'local',     // 优先本地
  REMOTE = 'remote'    // 优先远程
}

// 默认配置
export const DEFAULT_CONFIG = {
  // 同步类型
  type: SyncType.UP,

  // 是否启用 cookie 有效性验证
  enable_validation: true,

  // 验证超时时间 (毫秒)
  validation_timeout: 5000,

  // 合并策略
  merge_strategy: MergeStrategy.NEWEST,

  // 验证时使用的测试路径（用于检测是否登录）
  validation_paths: [
    '/',              // 根路径
    '/api/user',      // 常见的用户信息 API
    '/user/profile',  // 用户资料页面
    '/account'        // 账户页面
  ],

  // 需要跳过验证的域名列表
  skip_validation_domains: [],

  // 验证时检查的 HTTP 状态码
  valid_status_codes: [200, 201, 202, 204, 301, 302, 304],

  // 验证时检查的响应内容特征（登录后页面通常包含的内容）
  valid_content_patterns: [
    /logout/i,
    /sign.?out/i,
    /dashboard/i,
    /my.?account/i,
    /profile/i,
    /settings/i
  ]
};

// Cookie 属性优先级（用于合并时确定哪个 cookie 更新）
export const COOKIE_PRIORITY_FIELDS = [
  'expirationDate',  // 过期时间
  'lastAccessed',    // 最后访问时间（如果浏览器提供）
  'creationTime'     // 创建时间（如果浏览器提供）
];

// 存储键名
export const STORAGE_KEYS = {
  CONFIG: 'COOKIE_SYNC_SETTING',
  LAST_UPLOADED: 'LAST_UPLOADED_COOKIE',
  LAST_DOWNLOADED: 'LAST_DOWNLOADED_COOKIE',
  MERGE_CACHE: 'COOKIE_MERGE_CACHE',
  VALIDATION_CACHE: 'COOKIE_VALIDATION_CACHE'
};
