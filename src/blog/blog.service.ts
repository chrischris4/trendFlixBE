import { Injectable } from '@nestjs/common';
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
}

@Injectable()
export class BlogService {
  constructor(private prisma: PrismaService) {}

  private serialize(a: Awaited<ReturnType<typeof this.prisma.blogArticle.findFirst>>) {
    if (!a) return a;
    return { ...a, viewCount: a.viewCount !== null ? Number(a.viewCount) : null };
  }

  async findAll() {
    const rows = await this.prisma.blogArticle.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map(a => this.serialize(a));
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
      },
    });
    return this.serialize(a);
  }

  remove(id: number) {
    return this.prisma.blogArticle.delete({ where: { id } });
  }
}
