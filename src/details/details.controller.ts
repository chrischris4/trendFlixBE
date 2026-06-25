import { Controller, Get, Param } from '@nestjs/common';
import { DetailsService } from './details.service';

@Controller('details')
export class DetailsController {
  constructor(private readonly detailsService: DetailsService) {}

  @Get('movie/:id')
  getMovie(@Param('id') id: string) {
    return this.detailsService.getFullDetail('movie', parseInt(id));
  }

  @Get('tv/:id')
  getTv(@Param('id') id: string) {
    return this.detailsService.getFullDetail('tv', parseInt(id));
  }
}
