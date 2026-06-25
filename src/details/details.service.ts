import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class DetailsService {
  private readonly logger = new Logger(DetailsService.name);
  private readonly apiKey: string;
  private readonly base = 'https://api.themoviedb.org/3';

  constructor(private config: ConfigService, private http: HttpService) {
    this.apiKey = this.config.get<string>('TMDB_API_KEY') ?? '';
  }

  private async get(path: string, params: Record<string, any> = {}) {
    try {
      const { data } = await firstValueFrom(
        this.http.get(`${this.base}${path}`, { params: { api_key: this.apiKey, language: 'en-US', ...params } }),
      );
      return data;
    } catch (err: any) {
      this.logger.error(`TMDB error [${path}]: ${err.message}`);
      return null;
    }
  }

  async getDetail(type: 'movie' | 'tv', id: number) {
    const data = await this.get(`/${type}/${id}`);
    if (!data) return null;

    return {
      tmdbId: data.id,
      type,
      title: type === 'movie' ? data.title : data.name,
      originalTitle: type === 'movie' ? data.original_title : data.original_name,
      overview: data.overview ?? '',
      tagline: data.tagline ?? null,
      posterPath: data.poster_path ?? null,
      backdropPath: data.backdrop_path ?? null,
      voteAverage: data.vote_average ?? 0,
      voteCount: data.vote_count ?? 0,
      popularity: data.popularity ?? 0,
      releaseDate: type === 'movie' ? (data.release_date ?? null) : (data.first_air_date ?? null),
      genres: (data.genres ?? []).map((g: any) => ({ id: g.id, name: g.name })),
      originalLanguage: data.original_language ?? null,
      homepage: data.homepage ?? null,
      // Movie specific
      runtime: data.runtime ?? null,
      budget: data.budget ?? null,
      revenue: data.revenue ?? null,
      status: data.status ?? null,
      collection: data.belongs_to_collection ? {
        id: data.belongs_to_collection.id,
        name: data.belongs_to_collection.name,
        posterPath: data.belongs_to_collection.poster_path,
      } : null,
      // TV specific
      numberOfSeasons: data.number_of_seasons ?? null,
      numberOfEpisodes: data.number_of_episodes ?? null,
      episodeRuntime: data.episode_run_time?.[0] ?? null,
      networks: (data.networks ?? []).map((n: any) => ({ id: n.id, name: n.name, logoPath: n.logo_path })),
      inProduction: data.in_production ?? null,
    };
  }

  async getCredits(type: 'movie' | 'tv', id: number) {
    const data = await this.get(`/${type}/${id}/credits`);
    if (!data) return { cast: [], crew: [] };

    const cast = (data.cast ?? []).slice(0, 15).map((p: any) => ({
      id: p.id,
      name: p.name,
      character: p.character ?? '',
      profilePath: p.profile_path ?? null,
      order: p.order,
    }));

    const directors = (data.crew ?? [])
      .filter((p: any) => p.job === 'Director')
      .map((p: any) => ({ id: p.id, name: p.name, profilePath: p.profile_path ?? null }));

    const creators = (data.crew ?? [])
      .filter((p: any) => p.job === 'Executive Producer' || p.known_for_department === 'Writing')
      .slice(0, 3)
      .map((p: any) => ({ id: p.id, name: p.name, job: p.job, profilePath: p.profile_path ?? null }));

    return { cast, directors, creators };
  }

  async getVideos(type: 'movie' | 'tv', id: number) {
    const data = await this.get(`/${type}/${id}/videos`);
    if (!data) return [];

    return (data.results ?? [])
      .filter((v: any) => v.site === 'YouTube' && ['Trailer', 'Teaser'].includes(v.type))
      .slice(0, 3)
      .map((v: any) => ({ key: v.key, name: v.name, type: v.type, official: v.official }));
  }

  async getWatchProviders(type: 'movie' | 'tv', id: number) {
    const data = await this.get(`/${type}/${id}/watch/providers`);
    if (!data?.results) return {};

    const out: Record<string, any> = {};
    const priority = ['US', 'FR', 'GB', 'DE', 'CA', 'AU'];

    for (const country of priority) {
      const entry = data.results[country];
      if (!entry) continue;
      out[country] = {
        link: entry.link,
        flatrate: (entry.flatrate ?? []).map((p: any) => ({ id: p.provider_id, name: p.provider_name, logo: p.logo_path })),
        rent: (entry.rent ?? []).map((p: any) => ({ id: p.provider_id, name: p.provider_name, logo: p.logo_path })),
        buy: (entry.buy ?? []).map((p: any) => ({ id: p.provider_id, name: p.provider_name, logo: p.logo_path })),
      };
    }
    return out;
  }

  async getSimilar(type: 'movie' | 'tv', id: number) {
    const data = await this.get(`/${type}/${id}/similar`);
    if (!data) return [];

    return (data.results ?? []).slice(0, 12).map((item: any) => ({
      tmdbId: item.id,
      type,
      title: type === 'movie' ? item.title : item.name,
      posterPath: item.poster_path ?? null,
      voteAverage: item.vote_average ?? 0,
      releaseDate: type === 'movie' ? (item.release_date ?? null) : (item.first_air_date ?? null),
      genreIds: item.genre_ids ?? [],
    }));
  }

  async getKeywords(type: 'movie' | 'tv', id: number): Promise<string[]> {
    const data = await this.get(`/${type}/${id}/keywords`);
    if (!data) return [];
    const list = type === 'movie' ? (data.keywords ?? []) : (data.results ?? []);
    return list.slice(0, 20).map((k: any) => k.name);
  }

  async getFullDetail(type: 'movie' | 'tv', id: number) {
    const [detail, credits, videos, providers, similar, keywords] = await Promise.all([
      this.getDetail(type, id),
      this.getCredits(type, id),
      this.getVideos(type, id),
      this.getWatchProviders(type, id),
      this.getSimilar(type, id),
      this.getKeywords(type, id),
    ]);

    return { ...detail, credits, videos, providers, similar, keywords };
  }
}
