import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export interface TmdbItem {
  tmdbId: number;
  type: string;
  title: string;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  popularity: number;
  voteAverage: number;
  voteCount: number;
  releaseDate: string;
  genreIds: number[];
  originalLanguage: string;
}

@Injectable()
export class TmdbService {
  private readonly logger = new Logger(TmdbService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.themoviedb.org/3';

  constructor(private config: ConfigService, private http: HttpService) {
    this.apiKey = this.config.get<string>('TMDB_API_KEY') ?? '';
  }

  async fetchTrending(type: 'movie' | 'tv', timeWindow: 'day' | 'week' = 'week', pages = 5): Promise<TmdbItem[]> {
    try {
      const requests = Array.from({ length: pages }, (_, i) =>
        firstValueFrom(
          this.http.get(`${this.baseUrl}/trending/${type}/${timeWindow}`, {
            params: { api_key: this.apiKey, language: 'en-US', page: i + 1 },
          }),
        ),
      );
      const responses = await Promise.all(requests);
      const allResults = responses.flatMap(({ data }) => data.results ?? []);

      return allResults.map((item: any, i: number) => ({
        tmdbId: item.id,
        type,
        title: type === 'movie' ? item.title : item.name,
        overview: item.overview ?? '',
        posterPath: item.poster_path ?? null,
        backdropPath: item.backdrop_path ?? null,
        popularity: item.popularity ?? 0,
        voteAverage: item.vote_average ?? 0,
        voteCount: item.vote_count ?? 0,
        releaseDate: type === 'movie' ? (item.release_date ?? '') : (item.first_air_date ?? ''),
        genreIds: item.genre_ids ?? [],
        originalLanguage: item.original_language ?? '',
      }));
    } catch (err: any) {
      this.logger.error(`Erreur TMDB trending [${type}/${timeWindow}]: ${err.message}`);
      return [];
    }
  }

  async fetchByGenre(type: 'movie' | 'tv', genreId: number, page = 1): Promise<TmdbItem[]> {
    try {
      const { data } = await firstValueFrom(
        this.http.get(`${this.baseUrl}/discover/${type}`, {
          params: {
            api_key: this.apiKey,
            language: 'en-US',
            with_genres: genreId,
            sort_by: 'popularity.desc',
            page,
          },
        }),
      );
      return (data.results ?? []).map((item: any) => ({
        tmdbId: item.id,
        type,
        title: type === 'movie' ? item.title : item.name,
        overview: item.overview ?? '',
        posterPath: item.poster_path ?? null,
        backdropPath: item.backdrop_path ?? null,
        popularity: item.popularity ?? 0,
        voteAverage: item.vote_average ?? 0,
        voteCount: item.vote_count ?? 0,
        releaseDate: type === 'movie' ? (item.release_date ?? '') : (item.first_air_date ?? ''),
        genreIds: item.genre_ids ?? [],
        originalLanguage: item.original_language ?? '',
      }));
    } catch (err: any) {
      this.logger.error(`Erreur TMDB discover [${type}/genre:${genreId}]: ${err.message}`);
      return [];
    }
  }
}
