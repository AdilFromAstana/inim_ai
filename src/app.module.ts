import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TelegramService } from './telegram/telegram.service';
import { ReminderService } from './reminders/reminder.service';
import { FirebaseService } from './firebase/firebase.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
  ],
  providers: [TelegramService, ReminderService, FirebaseService],
})

export class AppModule { }
