import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DetailsController } from './details.controller';
import { DetailsService } from './details.service';

@Module({
  imports: [HttpModule],
  controllers: [DetailsController],
  providers: [DetailsService],
})
export class DetailsModule {}
