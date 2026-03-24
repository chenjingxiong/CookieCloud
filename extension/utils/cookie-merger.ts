/**
 * Cookie 合并模块
 * 负责合并本地和远程的 cookie 数据
 */

import { validateMultipleDomains, ValidationResult } from './cookie-validator';
import { MergeStrategy, DEFAULT_CONFIG } from './constants';

// Cookie 数据结构
export interface CookieData {
  cookie_data: Record<string, any[]>;
  local_storage_data: Record<string, any>;
  update_time?: string | Date;
}

// 合并结果接口
export interface MergeResult {
  cookie_data: Record<string, any[]>;
  local_storage_data: Record<string, any>;
  merge_summary: MergeSummary;
}

// 合并摘要
export interface MergeSummary {
  total_domains: number;
  local_only: string[];
  remote_only: string[];
  both_sources: string[];
  merged_domains: string[];
  validation_results: Record<string, ValidationResult>;
}

/**
 * 获取 cookie 的"新新程度"分数
 * 分数越高表示越新
 */
function getCookieFreshnessScore(cookie: any): number {
  let score = 0;

  // 过期时间是最重要的指标
  if (cookie.expirationDate) {
    // 距离过期时间越远，分数越高
    const expirationDate = new Date(cookie.expirationDate * 1000);
    const now = new Date();
    const daysUntilExpiration = (expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    score += Math.max(0, daysUntilExpiration * 10);
  }

  // 如果有最后访问时间，也考虑进去
  if (cookie.lastAccessed) {
    const lastAccessed = new Date(cookie.lastAccessed);
    const now = new Date();
    const hoursSinceAccess = (now.getTime() - lastAccessed.getTime()) / (1000 * 60 * 60);
    score -= hoursSinceAccess; // 越久未访问，分数越低
  }

  // 如果有创建时间
  if (cookie.creationTime) {
    const creationTime = new Date(cookie.creationTime);
    const now = new Date();
    const hoursSinceCreation = (now.getTime() - creationTime.getTime()) / (1000 * 60 * 60);
    score -= hoursSinceCreation * 0.5; // 越老，分数越低
  }

  return score;
}

/**
 * 比较两组 cookies，返回较新的一组
 */
function compareCookieFreshness(localCookies: any[], remoteCookies: any[]): 'local' | 'remote' {
  const localScore = localCookies.reduce((sum, cookie) => sum + getCookieFreshnessScore(cookie), 0) / localCookies.length;
  const remoteScore = remoteCookies.reduce((sum, cookie) => sum + getCookieFreshnessScore(cookie), 0) / remoteCookies.length;

  return localScore >= remoteScore ? 'local' : 'remote';
}

/**
 * 合并单个域名的 cookies
 */
function mergeDomainCookies(
  domain: string,
  localCookies: any[],
  remoteCookies: any[],
  localValid: boolean,
  remoteValid: boolean,
  strategy: MergeStrategy
): any[] {
  // 如果本地没有数据，使用远程
  if (!localCookies || localCookies.length === 0) {
    return remoteValid ? remoteCookies : [];
  }

  // 如果远程没有数据，使用本地
  if (!remoteCookies || remoteCookies.length === 0) {
    return localValid ? localCookies : [];
  }

  // 根据策略选择
  switch (strategy) {
    case MergeStrategy.LOCAL:
      return localValid ? localCookies : (remoteValid ? remoteCookies : []);

    case MergeStrategy.REMOTE:
      return remoteValid ? remoteCookies : (localValid ? localCookies : []);

    case MergeStrategy.NEWEST:
    default:
      // 如果两边都有效，取较新的
      if (localValid && remoteValid) {
        return compareCookieFreshness(localCookies, remoteCookies) === 'local'
          ? localCookies
          : remoteCookies;
      }
      // 优先取有效的
      return localValid ? localCookies : (remoteValid ? remoteCookies : []);
  }
}

/**
 * 合并 localStorage 数据
 * 如果两边都有数据，优先使用较新的（根据 update_time）
 */
function mergeLocalStorage(
  local: Record<string, any>,
  remote: Record<string, any>,
  strategy: MergeStrategy
): Record<string, any> {
  const result: Record<string, any> = {};

  // 获取所有域名
  const allDomains = new Set([
    ...Object.keys(local || {}),
    ...Object.keys(remote || {})
  ]);

  for (const domain of allDomains) {
    const localData = local?.[domain];
    const remoteData = remote?.[domain];

    if (!localData) {
      result[domain] = remoteData;
    } else if (!remoteData) {
      result[domain] = localData;
    } else {
      // 两边都有数据，根据策略选择
      switch (strategy) {
        case MergeStrategy.LOCAL:
          result[domain] = localData;
          break;
        case MergeStrategy.REMOTE:
          result[domain] = remoteData;
          break;
        case MergeStrategy.NEWEST:
        default:
          // localStorage 数据通常包含时间戳，优先取较新的
          // 如果没有时间戳，优先使用远程（假设远程是最新的）
          result[domain] = remoteData || localData;
      }
    }
  }

  return result;
}

/**
 * 主合并函数
 * 合并本地和远程的 cookie 数据
 */
export async function mergeCookieData(
  localData: CookieData,
  remoteData: CookieData,
  config: typeof DEFAULT_CONFIG = DEFAULT_CONFIG
): Promise<MergeResult> {
  const localCookies = localData?.cookie_data || {};
  const remoteCookies = remoteData?.cookie_data || {};
  const localStorage = localData?.local_storage_data || {};
  const remoteStorage = remoteData?.local_storage_data || {};

  // 获取所有域名
  const allDomains = new Set([
    ...Object.keys(localCookies),
    ...Object.keys(remoteCookies)
  ]);

  // 验证所有域名的 cookies
  const validationResults = await validateMultipleDomains(
    Object.fromEntries(
      Array.from(allDomains).map(domain => [
        domain,
        localCookies[domain] || remoteCookies[domain] || []
      ])
    ),
    config
  );

  // 合并摘要
  const summary: MergeSummary = {
    total_domains: allDomains.size,
    local_only: [],
    remote_only: [],
    both_sources: [],
    merged_domains: [],
    validation_results: validationResults
  };

  const mergedCookieData: Record<string, any[]> = {};

  // 合并每个域名的 cookies
  for (const domain of allDomains) {
    const local = localCookies[domain] || [];
    const remote = remoteCookies[domain] || [];

    const localValid = validationResults[domain]?.valid ?? true;
    const remoteValid = validationResults[domain]?.valid ?? true;

    // 分类域名来源
    if (local.length > 0 && remote.length === 0) {
      summary.local_only.push(domain);
    } else if (local.length === 0 && remote.length > 0) {
      summary.remote_only.push(domain);
    } else if (local.length > 0 && remote.length > 0) {
      summary.both_sources.push(domain);
    }

    // 合并 cookies
    const merged = mergeDomainCookies(
      domain,
      local,
      remote,
      localValid,
      remoteValid,
      config.merge_strategy
    );

    if (merged.length > 0) {
      mergedCookieData[domain] = merged;
      summary.merged_domains.push(domain);
    }
  }

  // 合并 localStorage
  const mergedLocalStorage = mergeLocalStorage(
    localStorage,
    remoteStorage,
    config.merge_strategy
  );

  return {
    cookie_data: mergedCookieData,
    local_storage_data: mergedLocalStorage,
    merge_summary: summary
  };
}

/**
 * 简化版合并（不验证）
 * 用于不需要验证的场景
 */
export function mergeCookieDataSimple(
  localData: CookieData,
  remoteData: CookieData,
  strategy: MergeStrategy = MergeStrategy.NEWEST
): MergeResult {
  const localCookies = localData?.cookie_data || {};
  const remoteCookies = remoteData?.cookie_data || {};
  const localStorage = localData?.local_storage_data || {};
  const remoteStorage = remoteData?.local_storage_data || {};

  const allDomains = new Set([
    ...Object.keys(localCookies),
    ...Object.keys(remoteCookies)
  ]);

  const summary: MergeSummary = {
    total_domains: allDomains.size,
    local_only: [],
    remote_only: [],
    both_sources: [],
    merged_domains: [],
    validation_results: {}
  };

  const mergedCookieData: Record<string, any[]> = {};

  for (const domain of allDomains) {
    const local = localCookies[domain] || [];
    const remote = remoteCookies[domain] || [];

    if (local.length > 0 && remote.length === 0) {
      summary.local_only.push(domain);
      mergedCookieData[domain] = local;
      summary.merged_domains.push(domain);
    } else if (local.length === 0 && remote.length > 0) {
      summary.remote_only.push(domain);
      mergedCookieData[domain] = remote;
      summary.merged_domains.push(domain);
    } else if (local.length > 0 && remote.length > 0) {
      summary.both_sources.push(domain);

      let selected = local;
      if (strategy === MergeStrategy.REMOTE ||
        (strategy === MergeStrategy.NEWEST && compareCookieFreshness(local, remote) === 'remote')) {
        selected = remote;
      }

      mergedCookieData[domain] = selected;
      summary.merged_domains.push(domain);
    }
  }

  const mergedLocalStorage = mergeLocalStorage(
    localStorage,
    remoteStorage,
    strategy
  );

  return {
    cookie_data: mergedCookieData,
    local_storage_data: mergedLocalStorage,
    merge_summary: summary
  };
}
