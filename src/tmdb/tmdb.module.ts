import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TmdbService } from './tmdb.service';

@Module({
  imports: [HttpModule],
  providers: [TmdbService],
  exports: [TmdbService],
})
export class TmdbModule {}
