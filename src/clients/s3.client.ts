// Type-only imports are erased at compile time, so `@aws-sdk/client-s3` and
// `@aws-sdk/s3-request-presigner` (both OPTIONAL peers) are required lazily
// via getS3Sdk()/getS3PresignerSdk() — importing this module never pulls
// either SDK unless the S3 client is actually used.
import type {
  S3Client as S3ClientType,
  HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import type { Readable } from 'stream';
import { BadRequestException } from '../exceptions';
import { S3_MESSAGES } from '../constants';
import { requireOptionalPeer } from '../helpers/optionalPeer.helper';

function getS3Sdk(): typeof import('@aws-sdk/client-s3') {
  return requireOptionalPeer<typeof import('@aws-sdk/client-s3')>(
    '@aws-sdk/client-s3',
    'S3 client',
  );
}

function getS3PresignerSdk(): typeof import('@aws-sdk/s3-request-presigner') {
  return requireOptionalPeer<typeof import('@aws-sdk/s3-request-presigner')>(
    '@aws-sdk/s3-request-presigner',
    'S3 client',
  );
}

export interface S3ClientConfig {
  region?: string;
  bucket?: string;
  /** Custom endpoint (LocalStack / MinIO). */
  endpoint?: string;
  /** Path-style addressing (needed for MinIO / LocalStack). */
  forcePathStyle?: boolean;
  /** Default presign TTL in seconds (default 900). */
  presignExpiresIn?: number;
  /** SSE-KMS key id; when set, objects are encrypted with aws:kms. */
  kmsKeyId?: string;
}

type PresignPutParams = {
  key: string;
  contentType: string;
  expiresIn?: number;
  bucket?: string;
  metadata?: Record<string, string>;
};

type PresignGetParams = {
  key: string;
  expiresIn?: number;
  bucket?: string;
  responseContentType?: string;
  responseContentDisposition?: string;
};

/**
 * S3 client for presigned-URL flows and direct put/get.
 *
 * - Uses the AWS SDK default credential provider chain (env, shared config,
 *   ECS/EC2 role, IRSA…) — no static keys.
 * - The underlying client is created lazily on first use, so importing the
 *   helper never fails when S3 is not configured.
 *
 * Instantiate once per service with the service's S3 config.
 */
export class S3Helper {
  private client: S3ClientType | null = null;
  private readonly config: S3ClientConfig;

  constructor(config: S3ClientConfig = {}) {
    this.config = config;
  }

  private get presignExpiresIn(): number {
    return this.config.presignExpiresIn ?? 900;
  }

  private assertEnabled(): void {
    if (!this.config.bucket) {
      throw new BadRequestException(S3_MESSAGES.BUCKET_REQUIRED);
    }
    if (!this.config.region) {
      throw new BadRequestException(S3_MESSAGES.REGION_REQUIRED);
    }
  }

  private getClient(): S3ClientType {
    if (this.client) return this.client;
    this.assertEnabled();
    const { S3Client } = getS3Sdk();
    this.client = new S3Client({
      region: this.config.region,
      ...(this.config.endpoint && { endpoint: this.config.endpoint }),
      ...(this.config.forcePathStyle && { forcePathStyle: true }),
    });
    return this.client;
  }

  async createPresignedPutUrl(params: PresignPutParams): Promise<{
    uploadUrl: string;
    bucket: string;
    key: string;
    expiresIn: number;
  }> {
    this.assertEnabled();
    const bucket = params.bucket ?? (this.config.bucket as string);
    const expiresIn = params.expiresIn ?? this.presignExpiresIn;

    const { PutObjectCommand } = getS3Sdk();
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: params.key,
      ContentType: params.contentType,
      Metadata: params.metadata,
      ServerSideEncryption: this.config.kmsKeyId ? 'aws:kms' : undefined,
      SSEKMSKeyId: this.config.kmsKeyId || undefined,
    });

    const { getSignedUrl } = getS3PresignerSdk();
    const uploadUrl = await getSignedUrl(this.getClient(), command, {
      expiresIn,
    });
    return { uploadUrl, bucket, key: params.key, expiresIn };
  }

  async putObject(params: {
    key: string;
    body: Buffer | Uint8Array;
    contentType?: string;
    bucket?: string;
    metadata?: Record<string, string>;
  }): Promise<{ bucket: string; key: string }> {
    this.assertEnabled();
    const bucket = params.bucket ?? (this.config.bucket as string);
    const { PutObjectCommand } = getS3Sdk();
    await this.getClient().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
        Metadata: params.metadata,
        ServerSideEncryption: this.config.kmsKeyId ? 'aws:kms' : undefined,
        SSEKMSKeyId: this.config.kmsKeyId || undefined,
      }),
    );
    return { bucket, key: params.key };
  }

  async getObjectStream(params: { key: string; bucket?: string }): Promise<{
    bucket: string;
    key: string;
    body: Readable;
    contentType?: string;
    contentLength?: number;
    metadata?: Record<string, string>;
  }> {
    this.assertEnabled();
    const bucket = params.bucket ?? (this.config.bucket as string);
    const { GetObjectCommand } = getS3Sdk();
    const out = await this.getClient().send(
      new GetObjectCommand({ Bucket: bucket, Key: params.key }),
    );
    const body = out.Body as unknown as Readable | undefined;
    if (
      !body ||
      typeof (body as unknown as { pipe?: unknown }).pipe !== 'function'
    ) {
      throw new Error('S3 GetObject did not return a readable stream body');
    }
    return {
      bucket,
      key: params.key,
      body,
      contentType: out.ContentType,
      contentLength: out.ContentLength,
      metadata: out.Metadata,
    };
  }

  async createPresignedGetUrl(params: PresignGetParams): Promise<{
    downloadUrl: string;
    bucket: string;
    key: string;
    expiresIn: number;
  }> {
    this.assertEnabled();
    const bucket = params.bucket ?? (this.config.bucket as string);
    const expiresIn = params.expiresIn ?? this.presignExpiresIn;
    const { GetObjectCommand } = getS3Sdk();
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: params.key,
      ResponseContentType: params.responseContentType,
      ResponseContentDisposition: params.responseContentDisposition,
    });
    const { getSignedUrl } = getS3PresignerSdk();
    const downloadUrl = await getSignedUrl(this.getClient(), command, {
      expiresIn,
    });
    return { downloadUrl, bucket, key: params.key, expiresIn };
  }

  async headObject(params: {
    key: string;
    bucket?: string;
  }): Promise<HeadObjectCommandOutput> {
    this.assertEnabled();
    const bucket = params.bucket ?? (this.config.bucket as string);
    const { HeadObjectCommand } = getS3Sdk();
    return await this.getClient().send(
      new HeadObjectCommand({ Bucket: bucket, Key: params.key }),
    );
  }
}

/** Convenience factory for an S3 helper. */
export function createS3Client(config: S3ClientConfig = {}): S3Helper {
  return new S3Helper(config);
}
