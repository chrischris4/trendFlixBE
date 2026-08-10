import { Controller, Get, NotFoundException, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { TrendingService } from './trending.service';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';

@Controller('trending')
export class TrendingController {
  constructor(private readonly trendingService: TrendingService) {}

  @Get()
  getTrending(@Query('type') type: string = 'all', @Query('limit') limit: string = '20') {
    const t = ['movie', 'tv'].includes(type) ? (type as 'movie' | 'tv') : 'all';
    return this.trendingService.getTrending(t, parseInt(limit));
  }

  // Recalcule les statistiques sans relancer une synchronisation TMDB complete,
  // utile pour valider le calcul juste apres un deploiement.
  @Post('stats/compute')
  @UseGuards(ApiKeyGuard)
  async computeStats() {
    await this.trendingService.computeDaysOnChart();
    await this.trendingService.computeDailyStats();
    return { computed: true };
  }

  @Get('stats')
  getStats() {
    return this.trendingService.getStats();
  }

  // Renouvellement quotidien d'un classement, precalcule par le cron.
  @Get('evolution')
  async getEvolution(@Query('type') type: string = 'movie', @Query('days') days: string = '7') {
    const t = type === 'tv' ? 'tv' : 'movie';
    const stats = await this.trendingService.getDailyStats(t, parseInt(days));
    return { type: t, total: stats.length, stats };
  }

  // Trajectoire d'un titre : pic de rang, pic de popularite, retombee, duree.
  @Get('history/:tmdbId')
  async getHistory(@Param('tmdbId', ParseIntPipe) tmdbId: number) {
    const history = await this.trendingService.getItemHistory(tmdbId);
    if (!history) throw new NotFoundException(`Aucun historique pour ${tmdbId}`);
    return history;
  }
}
