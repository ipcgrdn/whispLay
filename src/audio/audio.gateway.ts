import { 
  WebSocketGateway, 
  SubscribeMessage, 
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WsResponse 
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import * as path from 'path';
import { AudioService } from './audio.service';

interface ClientData {
  sessionId: string;
  connectedAt: Date;
  chunkCount: number;
  recordingStartedAt?: Date;
  recordingEndedAt?: Date;
}

@WebSocketGateway({
  cors: {
    origin: '*', // 개발 환경을 위한 설정, 프로덕션에서는 구체적인 도메인으로 제한해야 합니다
  },
})
export class AudioGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  
  private readonly logger = new Logger(AudioGateway.name);
  private clients = new Map<string, ClientData>();

  constructor(private readonly audioService: AudioService) {
    this.logger.log('AudioGateway 초기화됨');
  }

  afterInit(server: Server) {
    this.logger.log('WebSocket 서버 초기화 완료');
  }

  handleConnection(client: Socket, ...args: any[]) {
    // 새 클라이언트 연결 시 고유 세션 ID 할당
    const sessionId = client.id;
    
    this.clients.set(client.id, {
      sessionId: sessionId,
      connectedAt: new Date(),
      chunkCount: 0
    });
    
    // 세션별 디렉토리 생성
    const sessionDir = path.join(process.cwd(), 'audio_data', sessionId);
    this.audioService.ensureDirectoryExists(sessionDir);
    
    this.logger.log(`클라이언트 연결됨: ${client.id}, 현재 연결 수: ${this.clients.size}`);
    
    // 클라이언트에게 세션 ID 전송
    client.emit('session', { sessionId });
  }

  handleDisconnect(client: Socket) {
    const clientData = this.clients.get(client.id);
    
    if (clientData) {
      const duration = new Date().getTime() - clientData.connectedAt.getTime();
      const durationSeconds = Math.round(duration / 1000);
      
      this.logger.log(`클라이언트 연결 종료: ${client.id}`);
      this.logger.log(`세션 정보: 청크 수 ${clientData.chunkCount}, 연결 시간: ${durationSeconds}초`);
      
      // 녹음 중이었다면 세션 정리
      if (clientData.recordingStartedAt && !clientData.recordingEndedAt) {
        this.logger.log(`클라이언트 ${client.id}가 녹음 중 연결 종료됨. 세션 정리 중...`);
        this.handleStopRecording(client);
      }
      
      // 세션 정리
      this.audioService.cleanupSession(clientData.sessionId);
      this.clients.delete(client.id);
    }
    
    this.logger.log(`현재 연결 수: ${this.clients.size}`);
  }

  @SubscribeMessage('startRecording')
  handleStartRecording(client: Socket, payload: any): void {
    const clientData = this.clients.get(client.id);
    
    if (clientData) {
      clientData.recordingStartedAt = new Date();
      clientData.recordingEndedAt = undefined;
      clientData.chunkCount = 0;
      
      this.logger.log(`녹음 시작: ${client.id}, 시작 시간: ${clientData.recordingStartedAt.toISOString()}`);
      
      // 클라이언트에게 녹음 시작 확인 응답
      client.emit('recordingStarted', {
        sessionId: clientData.sessionId,
        startedAt: clientData.recordingStartedAt.toISOString()
      });
    }
  }

  @SubscribeMessage('stopRecording')
  handleStopRecording(client: Socket): void {
    const clientData = this.clients.get(client.id);
    
    if (clientData && clientData.recordingStartedAt && !clientData.recordingEndedAt) {
      clientData.recordingEndedAt = new Date();
      const duration = clientData.recordingEndedAt.getTime() - clientData.recordingStartedAt.getTime();
      const durationSeconds = Math.round(duration / 1000);
      
      this.logger.log(`녹음 종료: ${client.id}, 총 청크: ${clientData.chunkCount}, 녹음 시간: ${durationSeconds}초`);
      
      // 세션 정리
      this.audioService.cleanupSession(clientData.sessionId);
      
      // 클라이언트에게 녹음 종료 확인 응답
      client.emit('recordingStopped', {
        sessionId: clientData.sessionId,
        totalChunks: clientData.chunkCount,
        durationSeconds: durationSeconds
      });
    }
  }

  @SubscribeMessage('audioChunk')
  async handleAudioChunk(client: Socket, payload: any): Promise<WsResponse<any>> {
    try {
      const clientData = this.clients.get(client.id);
      
      if (!clientData) {
        throw new Error('클라이언트 정보를 찾을 수 없습니다');
      }
      
      if (!payload) {
        throw new Error('오디오 데이터가 없습니다');
      }
      
      // 녹음이 시작되지 않은 경우
      if (!clientData.recordingStartedAt) {
        throw new Error('녹음이 시작되지 않았습니다');
      }
      
      // 청크 번호 증가 및 할당
      clientData.chunkCount += 1;
      const currentChunkId = clientData.chunkCount;
      
      const isDelayedChunk = clientData.recordingEndedAt ? true : false;
      if (isDelayedChunk) {
        this.logger.debug(`지연된 오디오 청크 ${currentChunkId} 수신: 클라이언트 ${client.id} (녹음 종료 후)`);
      } else {
        this.logger.debug(`오디오 청크 ${currentChunkId} 수신: 클라이언트 ${client.id}`);
      }
      
      // 필요한 정보로 페이로드 보강
      const processedPayload = {
        ...payload,
        chunkId: currentChunkId,
        receivedAt: new Date().toISOString()
      };
      
      // 오디오 서비스를 통해 오디오 처리
      const result = await this.audioService.processAudioChunk(processedPayload, clientData.sessionId);
      
      if (result.success) {
        // 텍스트 변환 결과가 있으면 별도 이벤트로 전송
        if (result.transcription) {
          client.emit('transcriptionResult', {
            chunkId: currentChunkId,
            text: result.transcription.text,
            detectedLanguage: result.transcription.detectedLanguage,
            processedAt: result.processedAt
          });
          
          this.logger.log(`텍스트 변환 결과 전송: 청크 ${currentChunkId}`);
        }
        
        // 번역 결과가 있으면 별도 이벤트로 전송
        if (result.translation) {
          // 개별 클라이언트에게 전송
          client.emit('translationResult', {
            chunkId: currentChunkId,
            text: result.translation.text,
            isTranslated: result.translation.isTranslated,
            originalLanguage: result.translation.originalLanguage,
            processedAt: result.processedAt
          });
          
          // 모든 클라이언트에게 브로드캐스트 (오버레이 페이지 포함)
          this.server.emit('translationResult', {
            chunkId: currentChunkId,
            text: result.translation.text,
            isTranslated: result.translation.isTranslated,
            originalLanguage: result.translation.originalLanguage,
            processedAt: result.processedAt
          });
          
          this.logger.log(`번역 결과 전송: 청크 ${currentChunkId}`);
        }
        
        return {
          event: 'audioProcessed',
          data: {
            success: true,
            chunkId: currentChunkId,
            processedAt: result.processedAt,
            format: 'audio/wav', // 모든 처리된 파일은 WAV 형식
            isDelayedChunk: isDelayedChunk,
            hasTranscription: result.transcription !== null,
            hasTranslation: result.translation !== null
          }
        };
      } else {
        this.logger.error(`오디오 처리 실패: ${result.error}`);
        return {
          event: 'audioProcessed',
          data: {
            success: false,
            chunkId: currentChunkId,
            error: result.error,
            isDelayedChunk: isDelayedChunk
          }
        };
      }
    } catch (error) {
      this.logger.error(`오디오 청크 처리 오류: ${error.message}`);
      return {
        event: 'audioProcessed',
        data: {
          success: false,
          error: error.message
        }
      };
    }
  }
} 