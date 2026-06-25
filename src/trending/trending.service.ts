import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TmdbService } from '../tmdb/tmdb.service';

const CACHE_TTL = 60 * 60 * 1000;

@Injectable()
export class TrendingService implements OnModuleInit {
  private readonly logger = new Logger(TrendingService.name);
  private cache = new Map<string, { data: unknown; ts: number }>();

  constructor(private prisma: PrismaService, private tmdb: TmdbService) {}

  private fromCache<T>(key: string): T | null {
    const hit = this.cache.get(key);
    return hit && Date.now() - hit.ts < CACHE_TTL ? hit.data as T : null;
  }

  private toCache(key: string, data: unknown) {
    this.cache.set(key, { data, ts: Date.now() });
  }

  async onModuleInit() {
    const count = await this.prisma.trendingItem.count();
    if (count === 0) {
      this.logger.log('DB vide - sync initial...');
      await this.syncAll();
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async syncAll() {
    this.logger.log('Synchronisation TMDB...');
    await Promise.all([
      this.syncType('movie'),
      this.syncType('tv'),
    ]);
    await this.cleanOld();
    this.cache.clear();
    this.logger.log('Synchronisation terminée');
  }

  private async syncType(type: 'movie' | 'tv') {
    const items = await this.tmdb.fetchTrending(type, 'week', 5);
    if (!items.length) return;
    const fetchedAt = new Date();
    await this.prisma.trendingItem.createMany({
      data: items.map((item, i) => ({ ...item, rank: i + 1, fetchedAt })),
    });
    this.logger.debug(`[${type}] ${items.length} items enregistrés`);
  }

  private async cleanOld() {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.trendingItem.deleteMany({ where: { fetchedAt: { lt: cutoff } } });
    if (count > 0) this.logger.log(`${count} anciens items supprimés`);
  }

  async getTrending(type: 'movie' | 'tv' | 'all', limit = 20) {
    const key = `trending:${type}:${limit}`;
    const cached = this.fromCache<unknown[]>(key);
    if (cached) return cached;

    const latest = await this.prisma.trendingItem.findFirst({
      where: type === 'all' ? {} : { type },
      orderBy: { fetchedAt: 'desc' },
      select: { fetchedAt: true },
    });
    if (!latest) return [];

    const batchStart = new Date(latest.fetchedAt.getTime() - 60_000);
    const result = await this.prisma.trendingItem.findMany({
      where: {
        ...(type !== 'all' && { type }),
        fetchedAt: { gte: batchStart },
      },
      orderBy: [{ type: 'asc' }, { rank: 'asc' }],
      take: limit,
    });
    this.toCache(key, result);
    return result;
  }

  async getStats() {
    const cached = this.fromCache<unknown>('stats');
    if (cached) return cached;

    const latest = await this.prisma.trendingItem.findFirst({ orderBy: { fetchedAt: 'desc' }, select: { fetchedAt: true } });
    if (!latest) return null;
    const batchStart = new Date(latest.fetchedAt.getTime() - 60_000);

    const prevBatch = await this.prisma.trendingItem.findFirst({
      where: { fetchedAt: { lt: batchStart } },
      orderBy: { fetchedAt: 'desc' },
      select: { fetchedAt: true },
    });
    const prevBatchStart = prevBatch ? new Date(prevBatch.fetchedAt.getTime() - 60_000) : null;

    const [movies, shows, topMovies, topShows, allItems, prevItems] = await Promise.all([
      this.prisma.trendingItem.count({ where: { type: 'movie', fetchedAt: { gte: batchStart } } }),
      this.prisma.trendingItem.count({ where: { type: 'tv', fetchedAt: { gte: batchStart } } }),
      this.prisma.trendingItem.findMany({
        where: { type: 'movie', fetchedAt: { gte: batchStart } },
        orderBy: { rank: 'asc' },
        take: 5,
        select: { title: true, rank: true, voteAverage: true, popularity: true, tmdbId: true },
      }),
      this.prisma.trendingItem.findMany({
        where: { type: 'tv', fetchedAt: { gte: batchStart } },
        orderBy: { rank: 'asc' },
        take: 5,
        select: { title: true, rank: true, voteAverage: true, popularity: true, tmdbId: true },
      }),
      this.prisma.trendingItem.findMany({
        where: { fetchedAt: { gte: batchStart } },
        select: { genreIds: true, type: true, originalLanguage: true, releaseDate: true, tmdbId: true, voteAverage: true },
      }),
      prevBatchStart ? this.prisma.trendingItem.findMany({
        where: { fetchedAt: { gte: prevBatchStart, lt: batchStart } },
        select: { tmdbId: true },
      }) : Promise.resolve([]),
    ]);

    const prevIds = new Set(prevItems.map(i => i.tmdbId));
    const newThisWeek = allItems.filter(i => !prevIds.has(i.tmdbId)).length;

    const computeGenres = (type: string) => {
      const filtered = allItems.filter(i => i.type === type);
      const counts = new Map<number, number>();
      for (const item of filtered) {
        for (const gId of item.genreIds) {
          counts.set(gId, (counts.get(gId) ?? 0) + 1);
        }
      }
      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([genreId, count]) => ({ genreId, count, pct: Math.round((count / filtered.length) * 100) }));
    };

    const langCounts = new Map<string, number>();
    for (const item of allItems) {
      if (item.originalLanguage) langCounts.set(item.originalLanguage, (langCounts.get(item.originalLanguage) ?? 0) + 1);
    }
    const topLanguages = [...langCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([lang, count]) => ({ lang, count, pct: Math.round((count / allItems.length) * 100) }));

    const yearCounts = new Map<string, number>();
    for (const item of allItems) {
      if (item.releaseDate) {
        const year = String(item.releaseDate).substring(0, 4);
        if (year.match(/^\d{4}$/)) yearCounts.set(year, (yearCounts.get(year) ?? 0) + 1);
      }
    }
    const yearDistribution = [...yearCounts.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 6)
      .map(([year, count]) => ({ year, count, pct: Math.round((count / allItems.length) * 100) }));

    const avgMovieRating = +(allItems.filter(i => i.type === 'movie' && i.voteAverage).reduce((s, i) => s + (i.voteAverage ?? 0), 0) / (allItems.filter(i => i.type === 'movie' && i.voteAverage).length || 1)).toFixed(1);
    const avgShowRating = +(allItems.filter(i => i.type === 'tv' && i.voteAverage).reduce((s, i) => s + (i.voteAverage ?? 0), 0) / (allItems.filter(i => i.type === 'tv' && i.voteAverage).length || 1)).toFixed(1);

    const result = {
      movies,
      shows,
      topMovies,
      topShows,
      topMovieGenres: computeGenres('movie'),
      topShowGenres: computeGenres('tv'),
      topLanguages,
      yearDistribution,
      newThisWeek,
      avgMovieRating,
      avgShowRating,
      lastUpdated: latest.fetchedAt.toISOString(),
    };
    this.toCache('stats', result);
    return result;
  }
}
