/**
 * Cookie 有效性验证模块
 * 通过访问受保护资源来验证 cookie 是否有效
 */

import browser from 'webextension-polyfill';
import { DEFAULT_CONFIG, STORAGE_KEYS } from './constants';

// 验证结果接口
export interface ValidationResult {
  valid: boolean;
  domain: string;
  statusCode?: number;
  hasValidContent?: boolean;
  error?: string;
  checkedAt: number;
}

// 验证缓存
interface ValidationCache {
  [domain: string]: {
    result: ValidationResult;
    expiresAt: number;
  };
}

/**
 * 检查域名是否应该跳过验证
 */
function shouldSkipValidation(domain: string, skipList: string[]): boolean {
  return skipList.some(skipDomain => domain.includes(skipDomain));
}

/**
 * 构建 URL 用于验证
 */
function buildValidationUrl(domain: string, paths: string[]): string {
  // 移除开头的点号（如果有的话）
  let cleanDomain = domain.startsWith('.') ? domain.substring(1) : domain;

  // 确保有协议前缀
  if (!cleanDomain.startsWith('http://') && !cleanDomain.startsWith('https://')) {
    cleanDomain = 'https://' + cleanDomain;
  }

  // 尝试第一个可用的路径
  for (const path of paths) {
    try {
      const url = new URL(path, cleanDomain);
      return url.toString();
    } catch {
      continue;
    }
  }

  return cleanDomain;
}

/**
 * 检查响应内容是否包含登录状态的特征
 */
function hasValidContentPatterns(content: string, patterns: RegExp[]): boolean {
  if (!content) return false;

  // 转换为小写以便匹配
  const lowerContent = content.toLowerCase();

  // 检查是否包含登录后的特征内容
  const hasLoginPattern = patterns.some(pattern => pattern.test(lowerContent));

  // 检查是否不包含登录页面的特征（如 login, signin 等）
  const hasLoginPagePattern = /login|signin|sign.?in|log.?in/i.test(lowerContent);

  return hasLoginPattern && !hasLoginPagePattern;
}

/**
 * 从缓存获取验证结果
 */
async function getCachedValidation(domain: string): Promise<ValidationResult | null> {
  try {
    const cacheData = await browser.storage.local.get(STORAGE_KEYS.VALIDATION_CACHE);
    const cache: ValidationCache = cacheData[STORAGE_KEYS.VALIDATION_CACHE] || {};

    const cached = cache[domain];
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }
  } catch (error) {
    console.error('Error reading validation cache:', error);
  }
  return null;
}

/**
 * 保存验证结果到缓存
 */
async function saveValidationCache(domain: string, result: ValidationResult): Promise<void> {
  try {
    const cacheData = await browser.storage.local.get(STORAGE_KEYS.VALIDATION_CACHE);
    const cache: ValidationCache = cacheData[STORAGE_KEYS.VALIDATION_CACHE] || {};

    // 缓存有效期 10 分钟
    const expiresAt = Date.now() + 10 * 60 * 1000;
    cache[domain] = { result, expiresAt };

    await browser.storage.local.set({ [STORAGE_KEYS.VALIDATION_CACHE]: cache });
  } catch (error) {
    console.error('Error saving validation cache:', error);
  }
}

/**
 * 验证单个域名的 cookie 是否有效
 * 通过尝试访问该域名的受保护资源来判断
 */
export async function validateDomainCookies(
  domain: string,
  cookies: any[],
  config: typeof DEFAULT_CONFIG = DEFAULT_CONFIG
): Promise<ValidationResult> {
  // 检查缓存
  const cached = await getCachedValidation(domain);
  if (cached) {
    return cached;
  }

  // 检查是否跳过验证
  if (shouldSkipValidation(domain, config.skip_validation_domains)) {
    const result: ValidationResult = {
      valid: true,
      domain,
      checkedAt: Date.now()
    };
    await saveValidationCache(domain, result);
    return result;
  }

  // 如果没有 cookies，直接返回无效
  if (!cookies || cookies.length === 0) {
    const result: ValidationResult = {
      valid: false,
      domain,
      error: 'No cookies found',
      checkedAt: Date.now()
    };
    await saveValidationCache(domain, result);
    return result;
  }

  // 如果不启用验证，直接返回有效
  if (!config.enable_validation) {
    const result: ValidationResult = {
      valid: true,
      domain,
      checkedAt: Date.now()
    };
    await saveValidationCache(domain, result);
    return result;
  }

  try {
    // 构建 URL
    const url = buildValidationUrl(domain, config.validation_paths);

    // 创建一个带有 cookies 的请求
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.validation_timeout);

    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-cache',
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const statusCode = response.status;
    const hasValidStatusCode = config.valid_status_codes.includes(statusCode);

    // 检查响应内容
    let hasValidContent = false;
    if (hasValidStatusCode) {
      try {
        const text = await response.text();
        hasValidContent = hasValidContentPatterns(text, config.valid_content_patterns);
      } catch {
        // 如果无法读取内容，只依赖状态码
      }
    }

    const result: ValidationResult = {
      valid: hasValidStatusCode && (hasValidContent || statusCode === 200),
      domain,
      statusCode,
      hasValidContent,
      checkedAt: Date.now()
    };

    await saveValidationCache(domain, result);
    return result;

  } catch (error: any) {
    const result: ValidationResult = {
      valid: false,
      domain,
      error: error.message || 'Validation failed',
      checkedAt: Date.now()
    };
    await saveValidationCache(domain, result);
    return result;
  }
}

/**
 * 批量验证多个域名的 cookies
 */
export async function validateMultipleDomains(
  domainCookiesMap: Record<string, any[]>,
  config: typeof DEFAULT_CONFIG = DEFAULT_CONFIG
): Promise<Record<string, ValidationResult>> {
  const results: Record<string, ValidationResult> = {};

  // 并行验证所有域名
  const validationPromises = Object.entries(domainCookiesMap).map(
    async ([domain, cookies]) => {
      const result = await validateDomainCookies(domain, cookies, config);
      return [domain, result] as [string, ValidationResult];
    }
  );

  const settledResults = await Promise.allSettled(validationPromises);

  for (const settled of settledResults) {
    if (settled.status === 'fulfilled') {
      const [domain, result] = settled.value;
      results[domain] = result;
    }
  }

  return results;
}

/**
 * 清除验证缓存
 */
export async function clearValidationCache(): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEYS.VALIDATION_CACHE);
}
