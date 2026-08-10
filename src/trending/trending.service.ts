import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TmdbService } from '../tmdb/tmdb.service';

// Fenetre d'historique conservee. 90 jours permettent des analyses d'evolution
// sur un trimestre glissant pour ~1 $/mois de stockage supplementaire ; les
// articles publies survivent de toute facon a la purge.
const RETENTION_DAYS = 90;

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
    // Le calcul des statistiques ne doit jamais faire echouer la synchronisation :
    // les releves du jour sont deja en base a ce stade.
    try {
      await this.computeDaysOnChart();
      await this.computeDailyStats();
    } catch (e) {
      this.logger.error(`Statistiques quotidiennes non calculées : ${(e as Error).message}`);
    }
    this.cache.clear();
    this.logger.log('Synchronisation terminée');
  }

  /**
   * Anciennete de chaque titre du releve du jour, en jours distincts passes au
   * classement. TMDB expose une popularite instantanee, jamais une duree.
   */
  async computeDaysOnChart() {
    const updated = await this.prisma.$executeRaw`
      WITH tenure AS (
        SELECT "type", "tmdbId",
               COUNT(DISTINCT ("fetchedAt" AT TIME ZONE 'UTC')::date)::int AS days
        FROM trending_items
        GROUP BY "type", "tmdbId"
      )
      UPDATE trending_items t
      SET "daysOnChart" = tenure.days
      FROM tenure
      WHERE t."type" = tenure."type"
        AND t."tmdbId" = tenure."tmdbId"
        AND (t."fetchedAt" AT TIME ZONE 'UTC')::date =
            (SELECT MAX(("fetchedAt" AT TIME ZONE 'UTC')::date) FROM trending_items)`;

    this.logger.log(`Ancienneté calculée pour ${updated} entrées`);
  }

  /**
   * Renouvellement quotidien de chaque classement, calcule une fois par jour.
   *
   * TMDB publie une popularite du moment : ni la part du classement renouvelee
   * depuis la veille, ni la duree de presence d'un titre. Les deux se deduisent
   * de nos releves successifs et sont precalculees ici.
   */
  async computeDailyStats() {
    const rows = await this.prisma.$queryRaw<Array<{
      type: string; entriesTotal: number; newEntries: number; droppedOut: number;
      uniqueLanguages: number; avgPopularity: number | null; topGainerId: number | null;
      topGainerTitle: string | null; topGainerDelta: number | null; topTenureId: number | null;
      topTenureTitle: string | null; topTenureDays: number | null;
    }>>`
      WITH snap AS (
        SELECT "type", "tmdbId", "title", "originalLanguage", "popularity", "rank",
               ("fetchedAt" AT TIME ZONE 'UTC')::date AS d
        FROM trending_items
      ),
      today AS (SELECT * FROM snap WHERE d = (SELECT MAX(d) FROM snap)),
      prev  AS (SELECT * FROM snap WHERE d = (SELECT MAX(d) FROM snap WHERE d < (SELECT MAX(d) FROM snap))),
      tenure AS (
        SELECT "type", "tmdbId", COUNT(DISTINCT d)::int AS days
        FROM snap GROUP BY "type", "tmdbId"
      ),
      gain AS (
        SELECT DISTINCT ON (t."type")
               t."type", t."tmdbId", t."title", (p."rank" - t."rank")::int AS delta
        FROM today t JOIN prev p ON p."type" = t."type" AND p."tmdbId" = t."tmdbId"
        WHERE p."rank" > t."rank"
        ORDER BY t."type", (p."rank" - t."rank") DESC
      ),
      best AS (
        SELECT DISTINCT ON (t."type")
               t."type", t."tmdbId", t."title", te.days
        FROM today t JOIN tenure te ON te."type" = t."type" AND te."tmdbId" = t."tmdbId"
        ORDER BY t."type", te.days DESC, t."rank" ASC
      )
      SELECT
        t."type",
        COUNT(*)::int AS "entriesTotal",
        COUNT(*) FILTER (WHERE p."tmdbId" IS NULL)::int AS "newEntries",
        (SELECT COUNT(*) FROM prev p2
          WHERE p2."type" = t."type"
            AND NOT EXISTS (SELECT 1 FROM today t2 WHERE t2."type" = p2."type" AND t2."tmdbId" = p2."tmdbId")
        )::int AS "droppedOut",
        COUNT(DISTINCT t."originalLanguage")::int AS "uniqueLanguages",
        AVG(t."popularity")::float AS "avgPopularity",
        MIN(g."tmdbId")::int AS "topGainerId", MIN(g."title") AS "topGainerTitle", MIN(g.delta)::int AS "topGainerDelta",
        MIN(b."tmdbId")::int AS "topTenureId", MIN(b."title") AS "topTenureTitle", MIN(b.days)::int AS "topTenureDays"
      FROM today t
      LEFT JOIN prev p ON p."type" = t."type" AND p."tmdbId" = t."tmdbId"
      LEFT JOIN gain g ON g."type" = t."type"
      LEFT JOIN best b ON b."type" = t."type"
      GROUP BY t."type"`;

    if (!rows.length) {
      this.logger.warn('Statistiques quotidiennes : aucun relevé à analyser');
      return;
    }

    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);

    for (const r of rows) {
      const churnPct = r.entriesTotal > 0 ? Math.round((r.newEntries / r.entriesTotal) * 100) : 0;
      const data = { ...r, churnPct, day };
      await this.prisma.dailyChartStat.upsert({
        where: { day_type: { day, type: r.type } },
        create: data,
        update: data,
      });
    }

    this.logger.log(`Statistiques quotidiennes calculées pour ${rows.length} classements`);
  }

  // Simple lecture des lignes precalculees, sans aucune agregation.
  async getDailyStats(type: 'movie' | 'tv', days = 7) {
    return this.prisma.dailyChartStat.findMany({
      where: { type },
      orderBy: { day: 'desc' },
      take: Math.min(days, 90),
    });
  }

  /**
   * Trajectoire d'un titre : la popularite TMDB decroit avec le temps, donc son
   * pic et sa pente disent bien plus que sa valeur du jour. Requete servie par
   * l'index sur tmdbId.
   */
  async getItemHistory(tmdbId: number) {
    const key = `history:${tmdbId}`;
    const cached = this.fromCache<unknown>(key);
    if (cached) return cached;

    const rows = await this.prisma.trendingItem.findMany({
      where: { tmdbId },
      orderBy: { fetchedAt: 'asc' },
    });
    if (!rows.length) return null;

    const dayOf = (d: Date) => d.toISOString().slice(0, 10);
    const latest = rows[rows.length - 1];

    const byDay = new Map<string, { rank: number; popularity: number | null }>();
    let peakRank = { rank: Number.MAX_SAFE_INTEGER, day: '' };
    let peakPopularity = { value: -1, day: '' };

    for (const row of rows) {
      const day = dayOf(row.fetchedAt);
      const existing = byDay.get(day);
      // Un jour peut porter plusieurs releves : on garde le meilleur rang.
      if (!existing || row.rank < existing.rank) byDay.set(day, { rank: row.rank, popularity: row.popularity });
      if (row.rank < peakRank.rank) peakRank = { rank: row.rank, day };
      if ((row.popularity ?? -1) > peakPopularity.value) peakPopularity = { value: row.popularity ?? 0, day };
    }

    const days = [...byDay.keys()].sort();
    const current = latest.popularity ?? 0;
    // Part de popularite perdue depuis le pic : mesure la retombee apres sortie.
    const decayPct = peakPopularity.value > 0
      ? Math.max(0, Math.round((1 - current / peakPopularity.value) * 100))
      : null;

    const result = {
      tmdbId,
      type: latest.type,
      title: latest.title,
      posterPath: latest.posterPath,
      overview: latest.overview,
      releaseDate: latest.releaseDate,
      originalLanguage: latest.originalLanguage,
      voteAverage: latest.voteAverage,
      voteCount: latest.voteCount,
      firstSeen: days[0],
      lastSeen: days[days.length - 1],
      daysOnChart: days.length,
      peakRank,
      peakPopularity,
      currentPopularity: current,
      decayPct,
      timeline: days.map(day => ({ day, rank: byDay.get(day)!.rank, popularity: byDay.get(day)!.popularity })),
    };

    this.toCache(key, result);
    return result;
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
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
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
