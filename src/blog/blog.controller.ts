import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, ParseIntPipe } from '@nestjs/common';
import { BlogService, CreateBlogArticleDto } from './blog.service';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';

@Controller('blog')
export class BlogController {
  constructor(private readonly blogService: BlogService) {}

  @Get()
  findAll() {
    return this.blogService.findAll();
  }

  @Get('all')
  @UseGuards(ApiKeyGuard)
  findAllAdmin() {
    return this.blogService.findAllAdmin();
  }

  // Declare apres 'all', sinon Nest ferait correspondre « all » au parametre.
  // Le texte integral n'est servi que sur la page de l'article.
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.blogService.findOne(id);
  }

  @Post()
  @UseGuards(ApiKeyGuard)
  create(@Body() dto: CreateBlogArticleDto) {
    return this.blogService.create(dto);
  }

  @Patch(':id')
  @UseGuards(ApiKeyGuard)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: Partial<CreateBlogArticleDto>) {
    return this.blogService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(ApiKeyGuard)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.blogService.remove(id);
  }
}
