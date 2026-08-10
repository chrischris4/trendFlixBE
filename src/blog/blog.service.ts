import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { BlogArticleFormat } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateBlogArticleItemDto {
  position?: number;
  tmdbId?: number;
  type?: string;
  title: string;
  channelTitle?: string;
  posterPath?: string;
  countryCount?: number;
  sectionTitleEn?: string;
  sectionTextEn?: string;
}

export interface CreateBlogArticleDto {
  format?: BlogArticleFormat;
  tmdbId?: number;
  type?: string;
  title?: string;
  titleEn?: string;
  channelTitle?: string;
  posterPath?: string;
  viewCount?: number;
  countryCount?: number;
  weekOf?: string;
  editorialEn?: string;
  introEn?: string;
  conclusionEn?: string;
  items?: CreateBlogArticleItemDto[];
  published?: boolean;
}

/** Longueur de l'extrait servi dans la liste, coupe sur un mot entier. */
const EXCERPT_LENGTH = 260;

@Injectable()
export class BlogService {
  private readonly logger = new Logger(BlogService.name);

  constructor(private prisma: PrismaService) {}

  private serialize(a: any) {
    if (!a) return a;
    const items = a.items?.length
      ? a.items
      : [{
          id: -a.id,
          articleId: a.id,
          position: 1,
          tmdbId: a.tmdbId,
          type: a.type,
          title: a.title,
          channelTitle: a.channelTitle,
          posterPath: a.posterPath,
          countryCount: a.countryCount,
          sectionTitleEn: null,
          sectionTextEn: null,
        }];
    return {
      ...a,
      viewCount: a.viewCount !== null ? Number(a.viewCount) : null,
      items,
    };
  }

  private wordCount(text?: string | null): number {
    return (text ?? '').trim().split(/\s+/).filter(Boolean).length;
  }

  /**
   * Nombre de mots reellement rendus sur la page article. Calcule ici pour que
   * la liste puisse s'en servir (seuil d'indexation, sitemap) sans transporter
   * le texte integral de chaque article.
   */
  private articleWordCount(a: any): number {
    const structured = [a.introEn, a.conclusionEn, ...(a.items ?? []).flatMap((i: any) => [i.sectionTitleEn, i.sectionTextEn])]
      .reduce((total: number, part: any) => total + this.wordCount(part), 0);
    return Math.max(structured, this.wordCount(a.editorialEn));
  }

  private excerpt(a: any): string {
    const source = (a.introEn || a.editorialEn || '').trim();
    if (source.length <= EXCERPT_LENGTH) return source;
    const cut = source.slice(0, EXCERPT_LENGTH);
    return cut.slice(0, cut.lastIndexOf(' ')).trimEnd() + '…';
  }

  /**
   * Projection de liste : ni texte integral, ni tableau d'elements. Ce endpoint
   * est appele sur l'accueil, la page blog, chaque article et le sitemap, donc
   * il ne doit transporter que ce qu'une carte affiche.
   */
  private toListItem(a: any) {
    const primary = a.items?.[0];
    return {
      id: a.id,
      format: a.format,
      title: a.title,
      titleEn: a.titleEn,
      tmdbId: primary?.tmdbId ?? a.tmdbId,
      type: primary?.type ?? a.type,
      channelTitle: primary?.channelTitle ?? a.channelTitle,
      posterPath: primary?.posterPath ?? a.posterPath,
      viewCount: a.viewCount !== null ? Number(a.viewCount) : null,
      countryCount: primary?.countryCount ?? a.countryCount ?? null,
      weekOf: a.weekOf,
      createdAt: a.createdAt,
      published: a.published,
      excerpt: this.excerpt(a),
      wordCount: this.articleWordCount(a),
      itemCount: a.items?.length ?? 1,
    };
  }

  private normalizeFormat(format?: BlogArticleFormat): BlogArticleFormat {
    if (!format) return BlogArticleFormat.SIMPLE;
    if (!Object.values(BlogArticleFormat).includes(format)) {
      throw new BadRequestException(`Format d'article inconnu : ${format}`);
    }
    return format;
  }

  private normalizeItems(items: CreateBlogArticleItemDto[]): CreateBlogArticleItemDto[] {
    return [...items]
      .sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER))
      .map((item, index) => {
        if (!item.title?.trim()) {
          throw new BadRequestException(`Titre manquant pour l'élément ${index + 1}`);
        }
        if (item.type && !['movie', 'tv'].includes(item.type)) {
          throw new BadRequestException(`Type invalide pour l'élément ${index + 1}`);
        }
        return {
          ...item,
          title: item.title.trim(),
          position: index + 1,
        };
      });
  }

  private legacyItem(dto: CreateBlogArticleDto): CreateBlogArticleItemDto | null {
    const title = dto.title ?? dto.titleEn;
    if (!title) return null;
    return {
      position: 1,
      tmdbId: dto.tmdbId,
      type: dto.type,
      title,
      channelTitle: dto.channelTitle,
      posterPath: dto.posterPath,
      countryCount: dto.countryCount,
    };
  }

  private buildEditorial(dto: CreateBlogArticleDto): string {
    if (dto.editorialEn?.trim()) return dto.editorialEn.trim();
    return [dto.introEn, ...(dto.items ?? []).map(item => item.sectionTextEn), dto.conclusionEn]
      .filter((part): part is string => Boolean(part?.trim()))
      .join('\n\n')
      .trim();
  }

  private itemCreateData(item: CreateBlogArticleItemDto) {
    return {
      position: item.position!,
      tmdbId: item.tmdbId ?? null,
      type: item.type ?? null,
      title: item.title,
      channelTitle: item.channelTitle ?? null,
      posterPath: item.posterPath ?? null,
      countryCount: item.countryCount ?? null,
      sectionTitleEn: item.sectionTitleEn ?? null,
      sectionTextEn: item.sectionTextEn ?? null,
    };
  }

  async findAll() {
    const rows = await this.prisma.blogArticle.findMany({
      where: { published: true },
      include: { items: { orderBy: { position: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(a => this.toListItem(a));
  }

  /** Article complet, servi uniquement sur sa propre page. */
  async findOne(id: number) {
    const article = await this.prisma.blogArticle.findFirst({
      where: { id, published: true },
      include: { items: { orderBy: { position: 'asc' } } },
    });
    if (!article) throw new NotFoundException(`Article ${id} introuvable`);
    return this.serialize(article);
  }

  async findAllAdmin() {
    const rows = await this.prisma.blogArticle.findMany({
      include: { items: { orderBy: { position: 'asc' } } },
      orderBy: [{ published: 'asc' }, { createdAt: 'desc' }],
    });
    return rows.map(a => this.serialize(a));
  }

  // Publie automatiquement un brouillon par jour, à 9h UTC (11h Paris l'été).
  // Les dates weekOf/createdAt sont mises au jour de publication pour que
  // le blog paraisse alimenté régulièrement.
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async publishNext() {
    const lastPublished = await this.prisma.blogArticle.findFirst({
      where: { published: true },
      orderBy: { createdAt: 'desc' },
      select: { format: true },
    });
    const preferredFormats = Object.values(BlogArticleFormat).filter(
      format => format !== BlogArticleFormat.SIMPLE && format !== lastPublished?.format,
    );

    // Les formats éditoriaux structurés passent avant les anciens articles
    // simples, sans répéter le même format deux jours de suite.
    const draft = await this.prisma.blogArticle.findFirst({
      where: {
        published: false,
        ...(preferredFormats.length ? { format: { in: preferredFormats } } : {}),
      },
      orderBy: { id: 'asc' },
    }) ?? await this.prisma.blogArticle.findFirst({
      where: { published: false, format: { not: BlogArticleFormat.SIMPLE } },
      orderBy: { id: 'asc' },
    }) ?? await this.prisma.blogArticle.findFirst({
      where: {
        published: false,
        ...(lastPublished ? { format: { not: lastPublished.format } } : {}),
      },
      orderBy: { id: 'asc' },
    }) ?? await this.prisma.blogArticle.findFirst({
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
    const suppliedItems = dto.items?.length ? dto.items : [];
    const fallbackItem = this.legacyItem(dto);
    const items = this.normalizeItems(
      suppliedItems.length ? suppliedItems : fallbackItem ? [fallbackItem] : [],
    );
    if (!items.length) {
      throw new BadRequestException('Un article doit contenir au moins un film ou une série');
    }

    const primary = items[0];
    const title = (dto.title ?? dto.titleEn ?? primary.title).trim();
    const titleEn = (dto.titleEn ?? dto.title ?? title).trim();
    const editorialEn = this.buildEditorial({ ...dto, items });
    if (!editorialEn) {
      throw new BadRequestException('Le texte de l’article est obligatoire');
    }

    const a = await this.prisma.blogArticle.create({
      data: {
        format: this.normalizeFormat(dto.format),
        tmdbId: dto.tmdbId ?? primary.tmdbId ?? null,
        type: dto.type ?? primary.type ?? null,
        title,
        titleEn,
        channelTitle: dto.channelTitle ?? primary.channelTitle ?? '',
        posterPath: dto.posterPath ?? primary.posterPath ?? null,
        viewCount: dto.viewCount ?? null,
        countryCount: dto.countryCount ?? primary.countryCount ?? null,
        weekOf: dto.weekOf ? new Date(dto.weekOf) : new Date(),
        editorialEn,
        introEn: dto.introEn ?? null,
        conclusionEn: dto.conclusionEn ?? null,
        published: dto.published ?? true,
        items: { create: items.map(item => this.itemCreateData(item)) },
      },
      include: { items: { orderBy: { position: 'asc' } } },
    });
    return this.serialize(a);
  }

  async update(id: number, dto: Partial<CreateBlogArticleDto>) {
    const normalizedItems = dto.items ? this.normalizeItems(dto.items) : undefined;
    if (dto.items && !normalizedItems?.length) {
      throw new BadRequestException('Un article doit contenir au moins un film ou une série');
    }
    const primary = normalizedItems?.[0];

    const data: any = {
      ...(dto.format !== undefined && { format: this.normalizeFormat(dto.format) }),
      ...(dto.tmdbId !== undefined && { tmdbId: dto.tmdbId ?? null }),
      ...(dto.type !== undefined && { type: dto.type ?? null }),
      ...(dto.title !== undefined && { title: dto.title }),
      ...(dto.titleEn !== undefined && { titleEn: dto.titleEn ?? null }),
      ...(dto.channelTitle !== undefined && { channelTitle: dto.channelTitle }),
      ...(dto.posterPath !== undefined && { posterPath: dto.posterPath ?? null }),
      ...(dto.viewCount !== undefined && { viewCount: dto.viewCount ?? null }),
      ...(dto.countryCount !== undefined && { countryCount: dto.countryCount ?? null }),
      ...(dto.weekOf !== undefined && { weekOf: new Date(dto.weekOf!) }),
      ...(dto.editorialEn !== undefined && { editorialEn: dto.editorialEn }),
      ...(dto.introEn !== undefined && { introEn: dto.introEn ?? null }),
      ...(dto.conclusionEn !== undefined && { conclusionEn: dto.conclusionEn ?? null }),
      ...(dto.published !== undefined && { published: dto.published }),
    };

    if (primary) {
      data.tmdbId = primary.tmdbId ?? null;
      data.type = primary.type ?? null;
      data.channelTitle = primary.channelTitle ?? '';
      data.posterPath = primary.posterPath ?? null;
      data.countryCount = primary.countryCount ?? null;
      data.items = {
        deleteMany: {},
        create: normalizedItems!.map(item => this.itemCreateData(item)),
      };
    }

    const a = await this.prisma.blogArticle.update({
      where: { id },
      data,
      include: { items: { orderBy: { position: 'asc' } } },
    });
    return this.serialize(a);
  }

  remove(id: number) {
    return this.prisma.blogArticle.delete({ where: { id } });
  }
}
