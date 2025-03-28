import { Module } from '@nestjs/common';
import { AudioService } from './audio.service';
import { AudioGateway } from './audio.gateway';
import { WhisperService } from './whisper.service';
import { TranslationService } from './translation.service';

@Module({
  controllers: [],
  providers: [AudioService, AudioGateway, WhisperService, TranslationService]
})
export class AudioModule {}
