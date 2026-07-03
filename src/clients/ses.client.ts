// Type-only imports are erased at compile time, so `@aws-sdk/client-ses`
// (an OPTIONAL peer) is required lazily inside methods — importing this module
// never pulls the SDK unless the SES client is actually used.
import type {
  SESClient as SESClientType,
  SendEmailCommandOutput,
} from '@aws-sdk/client-ses';
import logger from '../helpers/logger.helper';
import { requireOptionalPeer } from '../helpers/optionalPeer.helper';

export interface SesClientConfig {
  region?: string;
  /** Verified sender identity (Source). */
  fromEmail: string;
}

export interface SendMailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  cc?: string[];
  bcc?: string[];
  /** Override the default From for this message. */
  from?: string;
}

/**
 * Amazon SES email client. Uses the AWS SDK default credential provider chain.
 * The underlying client is created lazily on first send.
 */
export class SesClient {
  private client: SESClientType | null = null;
  private readonly config: SesClientConfig;

  constructor(config: SesClientConfig) {
    this.config = config;
  }

  private getClient(): SESClientType {
    if (this.client) return this.client;

    const { SESClient } = requireOptionalPeer<
      typeof import('@aws-sdk/client-ses')
    >('@aws-sdk/client-ses', 'SES client');
    this.client = new SESClient({ region: this.config.region });
    return this.client as SESClientType;
  }

  async sendMail(options: SendMailOptions): Promise<SendEmailCommandOutput> {
    const { SendEmailCommand } = requireOptionalPeer<
      typeof import('@aws-sdk/client-ses')
    >('@aws-sdk/client-ses', 'SES client');
    const toAddresses = Array.isArray(options.to) ? options.to : [options.to];
    const command = new SendEmailCommand({
      Source: options.from ?? this.config.fromEmail,
      Destination: {
        ToAddresses: toAddresses,
        ...(options.cc?.length && { CcAddresses: options.cc }),
        ...(options.bcc?.length && { BccAddresses: options.bcc }),
      },
      Message: {
        Subject: { Data: options.subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: options.html, Charset: 'UTF-8' },
          ...(options.text && {
            Text: { Data: options.text, Charset: 'UTF-8' },
          }),
        },
      },
    });

    try {
      const result = (await this.getClient().send(
        command,
      )) as SendEmailCommandOutput;
      logger.info('SES email sent', {
        to: toAddresses,
        subject: options.subject,
        messageId: result.MessageId,
      });
      return result;
    } catch (error) {
      logger.error('SES email send failed', {
        to: toAddresses,
        subject: options.subject,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}

/** Convenience factory for an SES client. */
export function createSesClient(config: SesClientConfig): SesClient {
  return new SesClient(config);
}
