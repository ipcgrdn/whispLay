import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as ffmpeg from 'fluent-ffmpeg';
import * as ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { WhisperService } from './whisper.service';
import { TranslationService } from './translation.service';

@Injectable()
export class AudioService {
  private readonly logger = new Logger(AudioService.name);
  private readonly outputDir: string;
  private readonly tempDir: string;

  constructor(
    private readonly whisperService: WhisperService,
    private readonly translationService: TranslationService
  ) {
    // FFmpeg 경로 설정
    ffmpeg.setFfmpegPath(ffmpegInstaller.path);
    
    // 오디오 저장 디렉토리 설정
    this.outputDir = path.join(process.cwd(), 'audio_data');
    this.ensureDirectoryExists(this.outputDir);
    
    // 임시 파일 디렉토리 설정
    this.tempDir = path.join(this.outputDir, 'temp');
    this.ensureDirectoryExists(this.tempDir);
    
    // 디스크 사용량 모니터링
    setInterval(() => {
      this.monitorDiskUsage();
    }, 30 * 60 * 1000); // 30분마다
  }

  /**
   * 디렉토리 존재 확인 및 생성
   */
  public ensureDirectoryExists(dir: string): boolean {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        this.logger.log(`디렉토리 생성됨: ${dir}`);
      }
      return true;
    } catch (error) {
      this.logger.error(`디렉토리 생성 오류: ${error.message}`);
      return false;
    }
  }

  /**
   * 파일 저장
   */
  public saveFile(filePath: string, data: Buffer | string): boolean {
    try {
      fs.writeFileSync(filePath, data);
      return true;
    } catch (error) {
      this.logger.error(`파일 저장 오류: ${error.message}`);
      return false;
    }
  }

  /**
   * FFmpeg를 사용하여 WebM 파일을 WAV로 변환
   */
  private async convertToWav(inputPath: string, outputPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        ffmpeg(inputPath)
          .outputOptions([
            '-c:a pcm_s16le',  // WAV용 코덱
            '-ar 16000',       // 샘플레이트 (STT에 적합)
            '-ac 1'            // 모노 채널
          ])
          .audioFilters('afftdn')  // 노이즈 제거 필터 추가
          .output(outputPath)
          .on('start', (commandLine) => {
            this.logger.debug(`FFmpeg 명령 실행: ${commandLine}`);
          })
          .on('error', (err) => {
            this.logger.error(`FFmpeg 변환 오류: ${err.message}`);
            resolve(false);
          })
          .on('end', () => {
            this.logger.debug(`FFmpeg 변환 성공: ${outputPath}`);
            resolve(true);
          })
          .run();
      } catch (error) {
        this.logger.error(`FFmpeg 실행 오류: ${error.message}`);
        resolve(false);
      }
    });
  }

  /**
   * 임시 파일 삭제
   */
  private cleanupTempFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      this.logger.error(`임시 파일 삭제 오류: ${error.message}`);
    }
  }

  /**
   * 오디오 처리 - WebSocket 게이트웨이에서 사용
   */
  public async processAudioChunk(audioData: any, sessionId: string): Promise<any> {
    try {
      const timestamp = new Date();
      const sessionDir = path.join(this.outputDir, sessionId);
      
      // 세션 디렉토리 확인/생성
      this.ensureDirectoryExists(sessionDir);
      
      // 오디오 데이터가 있으면 저장
      if (audioData.audio) {
        const chunkId = audioData.chunkId || crypto.randomBytes(4).toString('hex');
        // 파일명 형식: chunk_000001_timestamp.wav
        const fileName = `chunk_${String(chunkId).padStart(6, '0')}_${timestamp.toISOString().replace(/:/g, '-')}`;
        
        // 오디오 데이터를 Buffer로 변환
        const audioBuffer = Buffer.from(audioData.audio, 'base64');
        this.logger.log(`오디오 청크 ${chunkId} 수신: ${audioBuffer.length} 바이트`);
        
        // WebM 및 WAV 파일 경로
        const webmPath = path.join(this.tempDir, `${fileName}.webm`);
        const wavPath = path.join(sessionDir, `${fileName}.wav`);
        
        // WebM 파일 저장
        this.saveFile(webmPath, audioBuffer);
        
        // WebM을 WAV로 변환
        const converted = await this.convertToWav(webmPath, wavPath);
        
        if (!converted) {
          this.logger.warn(`청크 ${chunkId} WAV 변환 실패`);
          return {
            success: false,
            error: 'WAV 변환 실패'
          };
        }
        
        // 임시 WebM 파일 삭제
        this.cleanupTempFile(webmPath);
        
        // 변환된 WAV 파일을 Whisper API를 통해 텍스트로 변환
        const transcriptionResult = await this.whisperService.transcribeAudio(wavPath);
        
        // 번역 결과 객체 초기화
        interface TranslationResult {
          success: boolean;
          originalText: string;
          translatedText?: string;
          detectedLanguage?: string;
          isTranslated?: boolean;
          sentences?: Array<{
            original: string;
            translated: string;
            success: boolean;
            error?: string;
          }>;
          error?: string;
        }
        
        let translationResult: TranslationResult | null = null;
        
        // 텍스트 변환에 성공한 경우에만 번역 진행
        if (transcriptionResult.success && transcriptionResult.text) {
          // 텍스트를 문장 단위로 번역
          const sourceLang = transcriptionResult.detectedLanguage as any; // 감지된 언어
          
          this.logger.log(`감지된 언어: ${sourceLang || '자동 감지'}`);
          
          // 감지된 언어가 이미 한국어인 경우 영어로 번역
          if (sourceLang === 'ko' || sourceLang === 'korean') {
            this.logger.log('감지된 언어가 한국어입니다. 영어로 번역을 진행합니다.');
            // 한국어를 영어로 번역
            const result = await this.translationService.translateBySentences(
              transcriptionResult.text,
              sourceLang // 한국어로 명시하여 TranslationService에서 영어로 번역
            );
            
            translationResult = {
              ...result,
              isTranslated: result.success,
              detectedLanguage: sourceLang
            };
            
            if (result.success) {
              this.logger.log('번역 완료 [ko -> en]');
            } else {
              this.logger.error(`번역 실패: ${result.error}`);
            }
          } else {
            // 다른 언어인 경우 한국어로 번역 진행
            const result = await this.translationService.translateBySentences(
              transcriptionResult.text,
              sourceLang // TranslationService에서 변환
            );
            
            translationResult = {
              ...result,
              isTranslated: result.success
            };
            
            if (result.success) {
              this.logger.log(`번역 완료 [${sourceLang || '감지된 언어'} -> ko]`);
            } else {
              this.logger.error(`번역 실패: ${result.error}`);
            }
          }
        }
        
        // 간단한 메타데이터 저장
        const metaFilePath = path.join(sessionDir, `${fileName}.json`);
        const metadata = {
          chunkId: chunkId,
          timestamp: timestamp.toISOString(),
          format: 'audio/wav',
          originalFormat: audioData.format || 'audio/webm;codecs=opus',
          size: audioBuffer.length,
          sessionId: sessionId,
          fileName: fileName,
          transcription: {
            success: transcriptionResult.success,
            text: transcriptionResult.text || null,
            detectedLanguage: transcriptionResult.detectedLanguage || null,
            error: transcriptionResult.error || null,
            processingTime: transcriptionResult.processingTime || null
          },
          translation: translationResult ? {
            success: translationResult.success,
            originalText: translationResult.originalText || null,
            translatedText: translationResult.translatedText || null,
            detectedLanguage: translationResult.detectedLanguage || null,
            isTranslated: translationResult.isTranslated || false,
            error: translationResult.error || null
          } : null
        };
        
        this.saveFile(metaFilePath, JSON.stringify(metadata, null, 2));
        
        this.logger.debug(`오디오 청크 ${chunkId} 처리 완료: ${fileName}.wav`);
        
        return {
          success: true,
          processedAt: timestamp.toISOString(),
          transcription: transcriptionResult.success ? {
            text: transcriptionResult.text,
            detectedLanguage: transcriptionResult.detectedLanguage
          } : null,
          translation: translationResult && translationResult.success ? {
            text: translationResult.translatedText,
            isTranslated: translationResult.isTranslated || false,
            originalLanguage: transcriptionResult.detectedLanguage
          } : null
        };
      }
      
      return {
        success: true,
        processedAt: timestamp.toISOString()
      };
    } catch (error) {
      this.logger.error(`오디오 처리 오류: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 세션 정리 (녹음 종료 시 호출)
   */
  public cleanupSession(sessionId: string): void {
    const sessionDir = path.join(this.outputDir, sessionId);
    
    // 임시 디렉토리에서 해당 세션 관련 파일 정리
    try {
      const tempFiles = fs.readdirSync(this.tempDir);
      let cleanedCount = 0;
      
      for (const file of tempFiles) {
        if (file.includes(sessionId)) {
          const filePath = path.join(this.tempDir, file);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            cleanedCount++;
          }
        }
      }
      
      if (cleanedCount > 0) {
        this.logger.log(`세션 ${sessionId} 정리: 임시 파일 ${cleanedCount}개 삭제됨`);
      } else {
        this.logger.log(`세션 ${sessionId} 정리 완료`);
      }
    } catch (error) {
      this.logger.error(`세션 정리 중 오류: ${error.message}`);
    }
  }

  /**
   * 디스크 사용량 모니터링
   */
  private async monitorDiskUsage(): Promise<void> {
    try {
      const dirSize = await this.calculateDirectorySize(this.outputDir);
      const sizeInMB = dirSize / (1024 * 1024);
      
      this.logger.log(`오디오 데이터 디렉토리 크기: ${sizeInMB.toFixed(2)} MB`);
      
      // 디스크 사용량이 너무 많을 경우 경고
      const MAX_SIZE_GB = 10; // 10GB
      if (sizeInMB > MAX_SIZE_GB * 1024) {
        this.logger.warn(`오디오 데이터 디렉토리가 ${MAX_SIZE_GB}GB를 초과했습니다. 정리가 필요합니다.`);
        // 정책에 따라 오래된 파일 정리 메커니즘 구현 가능
        this.cleanupOldFiles();
      }
    } catch (error) {
      this.logger.error(`디스크 사용량 모니터링 오류: ${error.message}`);
    }
  }

  /**
   * 디렉토리 크기 계산
   */
  private async calculateDirectorySize(dirPath: string): Promise<number> {
    try {
      const files = fs.readdirSync(dirPath);
      let size = 0;
      
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = fs.statSync(filePath);
        
        if (stats.isDirectory()) {
          size += await this.calculateDirectorySize(filePath);
        } else {
          size += stats.size;
        }
      }
      
      return size;
    } catch (error) {
      this.logger.error(`디렉토리 크기 계산 오류: ${error.message}`);
      return 0;
    }
  }

  /**
   * 오래된 파일 정리 (디스크 공간 확보)
   */
  private async cleanupOldFiles(): Promise<void> {
    try {
      const MAX_AGE_DAYS = 7; // 7일 이상 된 파일 삭제
      const now = Date.now();
      const maxAge = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
      
      const sessions = fs.readdirSync(this.outputDir);
      let deletedCount = 0;
      
      for (const session of sessions) {
        const sessionDir = path.join(this.outputDir, session);
        
        if (fs.statSync(sessionDir).isDirectory() && session !== 'temp') { // temp 디렉토리 제외
          const files = fs.readdirSync(sessionDir);
          
          for (const file of files) {
            const filePath = path.join(sessionDir, file);
            const stats = fs.statSync(filePath);
            
            if (!stats.isDirectory() && (now - stats.mtimeMs > maxAge)) {
              fs.unlinkSync(filePath);
              deletedCount++;
            }
          }
          
          // 비어있는 세션 디렉토리 삭제
          if (fs.readdirSync(sessionDir).length === 0) {
            fs.rmdirSync(sessionDir);
          }
        }
      }
      
      // 임시 디렉토리 정리 (1일 이상 된 파일)
      const tempFiles = fs.readdirSync(this.tempDir);
      for (const file of tempFiles) {
        const filePath = path.join(this.tempDir, file);
        const stats = fs.statSync(filePath);
        
        if (!stats.isDirectory() && (now - stats.mtimeMs > 24 * 60 * 60 * 1000)) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      }
      
      if (deletedCount > 0) {
        this.logger.log(`오래된 파일 ${deletedCount}개가 삭제되었습니다.`);
      }
    } catch (error) {
      this.logger.error(`파일 정리 중 오류: ${error.message}`);
    }
  }
}
