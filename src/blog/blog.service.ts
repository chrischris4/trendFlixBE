import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateBlogArticleDto {
  tmdbId?: number;
  type?: string;
  title: string;
  channelTitle: string;
  posterPath?: string;
  viewCount?: number;
  countryCount?: number;
  weekOf: string;
  editorialFr: string;
  editorialEn: string;
  published?: boolean;
}

@Injectable()
export class BlogService {
  private readonly logger = new Logger(BlogService.name);

  constructor(private prisma: PrismaService) {}

  private serialize(a: Awaited<ReturnType<typeof this.prisma.blogArticle.findFirst>>) {
    if (!a) return a;
    return { ...a, viewCount: a.viewCount !== null ? Number(a.viewCount) : null };
  }

  async findAll() {
    const rows = await this.prisma.blogArticle.findMany({
      where: { published: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(a => this.serialize(a));
  }

  async findAllAdmin() {
    const rows = await this.prisma.blogArticle.findMany({
      orderBy: [{ published: 'asc' }, { createdAt: 'desc' }],
    });
    return rows.map(a => this.serialize(a));
  }

  // Publie automatiquement un brouillon par jour, à 9h UTC (11h Paris l'été).
  // Les dates weekOf/createdAt sont mises au jour de publication pour que
  // le blog paraisse alimenté régulièrement.
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async publishNext() {
    const draft = await this.prisma.blogArticle.findFirst({
      where: { published: false },
      orderBy: { id: 'asc' },
    });
    if (!draft) return;

    const now = new Date();
    await this.prisma.blogArticle.update({
      where: { id: draft.id },
      data: { published: true, weekOf: now, createdAt: now },
    });
    this.logger.log(`Article #${draft.id} publié automatiquement : ${draft.title}`);
  }

  async create(dto: CreateBlogArticleDto) {
    const a = await this.prisma.blogArticle.create({
      data: {
        tmdbId: dto.tmdbId ?? null,
        type: dto.type ?? null,
        title: dto.title,
        channelTitle: dto.channelTitle,
        posterPath: dto.posterPath ?? null,
        viewCount: dto.viewCount ?? null,
        countryCount: dto.countryCount ?? null,
        weekOf: new Date(dto.weekOf),
        editorialFr: dto.editorialFr,
        editorialEn: dto.editorialEn,
        published: dto.published ?? true,
      },
    });
    return this.serialize(a);
  }

  async update(id: number, dto: Partial<CreateBlogArticleDto>) {
    const a = await this.prisma.blogArticle.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.channelTitle !== undefined && { channelTitle: dto.channelTitle }),
        ...(dto.posterPath !== undefined && { posterPath: dto.posterPath }),
        ...(dto.viewCount !== undefined && { viewCount: dto.viewCount ?? null }),
        ...(dto.weekOf !== undefined && { weekOf: new Date(dto.weekOf) }),
        ...(dto.editorialFr !== undefined && { editorialFr: dto.editorialFr }),
        ...(dto.editorialEn !== undefined && { editorialEn: dto.editorialEn }),
        ...(dto.published !== undefined && { published: dto.published }),
      },
    });
    return this.serialize(a);
  }

  remove(id: number) {
    return this.prisma.blogArticle.delete({ where: { id } });
  }
}
