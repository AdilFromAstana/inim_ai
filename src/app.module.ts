import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramService } from './telegram/telegram.service';
import { ReminderService } from './reminders/reminder.service';
import { Reminder } from './reminders/reminder.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST', 'localhost'),
        port: parseInt(config.get<string>('DB_PORT', '5432'), 10),
        username: config.get<string>('DB_USER', 'postgres'),
        password: config.get<string>('DB_PASS', ''),
        database: config.get<string>('DB_NAME', 'inim_ai'),
        entities: [Reminder],
        synchronize: true,
      }),
    }),

    TypeOrmModule.forFeature([Reminder]),
  ],
  providers: [TelegramService, ReminderService],
})
export class AppModule { }
