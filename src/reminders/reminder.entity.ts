import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

@Entity('reminders')
export class Reminder {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    userId: number;

    @Column()
    text: string;

    @Column({ type: 'timestamp' })
    datetime: Date;

    @Column({ default: false })
    isSent: boolean;

    @CreateDateColumn()
    createdAt: Date;
}
