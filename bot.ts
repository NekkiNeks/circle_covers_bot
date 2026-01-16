import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import pfs from 'fs/promises';

const BOT_TOKEN = '8504277957:AAEgUjf1zjVmMmODe7hVSBM_sZ84aLOkcj0';
const TEMP_DIR = './temp';

const bot = new Telegraf(BOT_TOKEN);

const sessions = new Map<
	number,
	{
		imagePath?: string;
		audioPath?: string;
		startSec?: number;
	}
>();

// --------------------
// Фото
// --------------------
bot.on(message('photo'), async ctx => {
	try {
		if (!ctx.message?.photo) return;

		const chatId = ctx.chat?.id;
		if (!chatId) return;

		await ctx.reply('Загружаю изображение...');
		const imageId = ctx.message.photo.at(-1)!.file_id;
		const imagePath = path.join(TEMP_DIR, `image_${chatId}.jpg`);
		const fileLink = await ctx.telegram.getFileLink(imageId);
		const res = await fetch(fileLink.href);
		fs.writeFileSync(imagePath, Buffer.from(await res.arrayBuffer()));

		sessions.set(chatId, { imagePath });

		await ctx.reply('Изображение получено ✅. Теперь отправь аудио или voice 🎧');
	} catch (error) {
		const replyMessage = error.message || 'Неизвестная ошибка на стороне сервера';
		ctx.reply(`Ошибка обработки запроса: ${replyMessage}`);
	}
});

// --------------------
// Аудио / Voice
// --------------------
bot.on(message('audio'), async ctx => {
	try {
		if (!ctx.message?.audio) return;

		const chatId = ctx.chat?.id;
		if (!chatId) return;

		const session = sessions.get(chatId);
		if (!session?.imagePath) {
			await ctx.reply('Сначала нужно отправить фото.');
			return;
		}

		const fileId = ctx.message.audio.file_id;

		await ctx.reply('Загружаю аудио...');
		const audioPath = path.join(TEMP_DIR, `track_${chatId}.mp3`);
		const fileLink = await ctx.telegram.getFileLink(fileId);
		const res = await fetch(fileLink.href);
		fs.writeFileSync(audioPath, Buffer.from(await res.arrayBuffer()));

		session.audioPath = audioPath;
		sessions.set(chatId, session);

		await ctx.reply('Аудио получено ✅. Теперь отправь время старта в секундах (например: 15) ⏱️');
	} catch (error) {
		const replyMessage = error.message || 'Неизвестная ошибка на стороне сервера';
		ctx.reply(`Ошибка обработки запроса: ${replyMessage}`);
	}
});

// --------------------
// Время старта
// --------------------
bot.on(message('text'), async ctx => {
	try {
		if (!ctx.message?.text) return;

		const chatId = ctx.chat?.id;
		if (!chatId) return;

		const session = sessions.get(chatId);
		if (!session?.imagePath || !session?.audioPath) return;

		if (!session.imagePath || !session.audioPath) {
			throw new Error('Отсутствуют обложка или аудио');
		}

		const startSec = parseInt(ctx.message.text, 10);
		if (isNaN(startSec) || startSec < 0) {
			await ctx.reply('Пожалуйста, отправь корректное число секунд (0 и больше).');
			return;
		}

		session.startSec = startSec;
		sessions.set(chatId, session);

		const outputPath = path.join(TEMP_DIR, `output_${chatId}.mp4`);

		await ctx.reply('Генерирую видео ⏳');

		// Запускаем render.sh с передачей секунды старта
		exec(`bash render.sh "${session.imagePath}" "${session.audioPath}" "${outputPath}" 30 ${startSec}`, async error => {
			if (error) {
				console.error(error);
				await ctx.reply('Ошибка при рендере видео.');
				return;
			}

			const fileBuffer = await pfs.readFile(outputPath);
			await ctx.sendVideoNote({ source: fileBuffer });

			// Чистим сессию
			sessions.delete(chatId);
		});
	} catch (error) {
		const replyMessage = error.message || 'Неизвестная ошибка на стороне сервера';
		ctx.reply(`Ошибка обработки запроса: ${replyMessage}`);
	}
});

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// test message
bot.on(message('text'), async ctx => {
	if (ctx.message.text === 'test') {
		const imagePath = path.join(TEMP_DIR, `test_pic.jpg`);
		const audioPath = path.join(TEMP_DIR, `test_audio.mp3`);
		const outputPath = path.join(TEMP_DIR, `test_out.mp4`);

		exec(`bash render.sh "${imagePath}" "${audioPath}" "${outputPath}" `, async error => {
			if (error) {
				console.error(error);
				await ctx.reply('Ошибка при рендере видео.');
				return;
			}

			const fileBuffer = await pfs.readFile(outputPath);
			await ctx.sendVideoNote({ source: fileBuffer });
		});
	} else {
		await ctx.reply('Не могу обработать данный запрос');
	}

	return;
});
