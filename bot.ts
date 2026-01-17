import { Composer, Context, Scenes, session, Telegraf, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import path from 'node:path';
import fs from 'node:fs';
import pfs from 'fs/promises';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import 'dotenv/config';

const execAsync = promisify(exec);

/* ===== Тип состояния сцены ===== */
interface WizardState {
	imagePath?: string;
	audioPath?: string;
	startSec?: number;
	lengthSec?: number;
	choice?: 'DEFAULT' | 'VINYL' | 'CD';
}

const UserStates = new Map<number, WizardState>();

const TEMP_DIR = './temp';
let BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
	throw new Error('Отсутсвует BOT_TOKEN в env');
}

const bot = new Telegraf<Scenes.WizardContext>(BOT_TOKEN, { handlerTimeout: 900000 });

// ПОлучение изображения
const imageStep = new Composer<Scenes.WizardContext>();
imageStep.on(message('photo'), async ctx => {
	const chatId = getChatId(ctx);
	ctx.reply('Загружаю фото...');

	const imageId = ctx.message.photo.at(-1)!.file_id;
	const imagePath = path.join(TEMP_DIR, `image_${chatId}.jpg`);
	const fileLink = await ctx.telegram.getFileLink(imageId);
	const res = await fetch(fileLink.href);
	fs.writeFileSync(imagePath, Buffer.from(await res.arrayBuffer()));

	UserStates.set(chatId, { imagePath });

	await ctx.reply('Фото получено ✅ \nТеперь отправь аудио 🎧');
	return ctx.wizard.next();
});

// Получение аудио
const audioStep = new Composer<Scenes.WizardContext>();
audioStep.on(message('audio'), async ctx => {
	const chatId = getChatId(ctx);

	const fileId = ctx.message.audio.file_id;

	await ctx.reply('Загружаю аудио, это может занять какое-то время...');
	const audioPath = path.join(TEMP_DIR, `track_${chatId}.mp3`);
	const fileLink = await ctx.telegram.getFileLink(fileId);
	const res = await fetch(fileLink.href);
	fs.writeFileSync(audioPath, Buffer.from(await res.arrayBuffer()));

	// TODO: Вынести в отдельный метод
	const userState = UserStates.get(chatId);
	if (!userState) throw new Error('Ошибка получения загруженных данных');
	userState.audioPath = audioPath;
	UserStates.set(chatId, userState);

	await ctx.reply('Аудио получено ✅ \nВведите время старта в секундах (например: 15) ⏱️');

	return ctx.wizard.next();
});

// Получение времени старта аудио
const startSecStep = new Composer<Scenes.WizardContext>();
startSecStep.on(message('text'), async ctx => {
	const chatId = getChatId(ctx);

	const startSec = parseInt(ctx.message.text, 10);
	if (isNaN(startSec) || startSec < 0) {
		await ctx.reply('❌ Пожалуйста, отправь корректное число секунд (0 и больше).');
		return;
	}

	// TODO: Вынести в отдельный метод
	const userState = UserStates.get(chatId);
	if (!userState) throw new Error('Ошибка получения загруженных данных');
	userState.startSec = startSec;
	UserStates.set(chatId, userState);

	await ctx.reply(
		`Время старта установлено: ${startSec} сек ✅\nВведите продолжительность видео в секундах (например: 30) ⏱️ \n❗Кружочки не могут быть дольше 59 секунд... `,
	);

	// Переходим к следующему шагу
	return ctx.wizard.next();
});

const lenghtSecStep = new Composer<Scenes.WizardContext>();
lenghtSecStep.on(message('text'), async ctx => {
	const chatId = getChatId(ctx);

	const lengthSec = parseInt(ctx.message.text, 10);
	if (isNaN(lengthSec) || lengthSec < 10) {
		await ctx.reply('❌ Пожалуйста, отправь корректное число секунд (10 и больше).');
		return;
	}

	if (lengthSec > 59) {
		await ctx.reply('❌ Длительность не может быть больше 59 секунд..');
	}

	// TODO: Вынести в отдельный метод
	const userState = UserStates.get(chatId);
	if (!userState) throw new Error('Ошибка получения загруженных данных');
	userState.lengthSec = lengthSec;
	UserStates.set(chatId, userState);

	await ctx.reply(`Время длительности установлено: ${lengthSec} сек ✅`);

	await ctx.reply(
		'Выбери вариант отображения обложки:',
		Markup.inlineKeyboard([
			Markup.button.callback('Стандартный', 'DEFAULT'),
			Markup.button.callback('Винил', 'VINYL'),
			Markup.button.callback('CD Диск', 'CD'),
		]),
	);

	// Переходим к следующему шагу
	return ctx.wizard.next();
});

const coverTypeStep = new Composer<Scenes.WizardContext>();
coverTypeStep.on('callback_query', async ctx => {
	if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) {
		await ctx.reply('Пожалуйста, выбери вариант кнопкой');
		return;
	}

	const selectedCoverType = ctx.callbackQuery.data as 'DEFAULT' | 'VINYL' | 'CD';

	const chatId = getChatId(ctx);

	const userState = UserStates.get(chatId);
	if (!userState) throw new Error('Ошибка получения данных пользователя');

	userState.choice = selectedCoverType;
	UserStates.set(chatId, userState);

	await ctx.answerCbQuery('Выбор принят...');
	await ctx.reply(`Выбран тип обложки: \`${selectedCoverType}\` ✅`, { parse_mode: 'MarkdownV2' });

	await ctx.reply('Начинаю генерацию видео...');

	const fileBuffer = await generateVideo(chatId, userState);
	await ctx.reply('Видео сгенерированно и уже отправляется вам, подождите еще немного...');

	await ctx.sendVideoNote({ source: fileBuffer }).catch(err => console.warn(`Ошибка при отправке результата пользователю: `, err));
	await ctx.reply('Готово! Для того чтобы снова сгенерировать видео просто выберите "Начать" в меню бота. ');

	return ctx.scene.leave();
});

const scene = new Scenes.WizardScene<Scenes.WizardContext>(
	'sceneId',
	async ctx => {
		await ctx.reply('Отправьте изображение...');
		return ctx.wizard.next();
	},
	imageStep,
	audioStep,
	startSecStep,
	lenghtSecStep,
	coverTypeStep,
);

const stage = new Scenes.Stage<Scenes.WizardContext>([scene]);

// Обработка ошибок
bot.catch(async (err, ctx) => {
	console.error('Ошибка при использовании бота: ', err);

	if (ctx) {
		await ctx.reply(
			`*ОШИБКА:* \nПри обработке данных произошла ошибка, попробуйте еще раз.` +
				`Если ошибка будет повторяться сообщите об этом разработчику \`@nekkinekkinekki\`\n`,
			{ parse_mode: 'MarkdownV2' },
		);

		ctx.reply('Процесс вынужденно завершен..');
		ctx.scene.leave();
	}
});

bot.use(session());
bot.use(stage.middleware());

const mainMenu = Markup.keyboard([['Начать', 'Отмена']])
	.resize()
	.oneTime(false); // клавиатура не пропадает после нажатия

bot.start(async ctx => {
	await ctx.reply('Для начала создания кружка выбери "Начать" в меню.', mainMenu);
});

// Обновляем клавиатуру при сбросе сцены или завершении
bot.hears('Отмена', async ctx => {
	await ctx.reply('Процесс отменен ✅', mainMenu);
	return ctx.scene.leave();
});

bot.command('debug', async ctx => {
	const chatId = getChatId(ctx);
	const data = UserStates.get(chatId);
	const dataAsString = JSON.stringify(data, null, 2);

	// Отображение в консоль
	console.log(`debug called. Data: \n${dataAsString}`);

	// Составление сообщения для пользователя
	const message = data ? '```\n' + dataAsString + '\n```' : `Не удалось получить данные chatID: \`${chatId}\` `;

	// Отправка данных пользователю
	await ctx.reply(message, { parse_mode: 'MarkdownV2' });
});

bot.hears('Начать', ctx => ctx.scene.enter('sceneId'));

bot.launch();

const me = await bot.telegram.getMe();
console.log(`🤖 Bot started: @${me.username} (id: ${me.id}) (token: ${BOT_TOKEN})`);

// -- Функции --
function getChatId(ctx: Context): number {
	const chatId = ctx.chat?.id;

	if (!chatId) throw new Error('Ошибка получения ID чата.');

	return chatId;
}

async function generateVideo(chatId: number, userState: WizardState): Promise<Buffer> {
	try {
		if (!userState.imagePath || !userState.audioPath || userState.startSec === undefined || !userState.lengthSec || !userState.choice) {
			throw new Error(`Не все данные для генерации видео указаны! \n ${JSON.stringify(userState, null, 2)}`);
		}

		const outputPath = path.join(TEMP_DIR, `output_${chatId}.mp4`);

		// Формируем команду для bash
		const cmd = `bash renders/${userState.choice}.sh "${userState.imagePath}" "${userState.audioPath}" "${outputPath}" "${userState.lengthSec}" ${userState.startSec}`;

		// Ждём пока скрипт выполнится
		await execAsync(cmd);

		// Читаем готовый файл в Buffer
		const buffer = await pfs.readFile(outputPath);

		return buffer;
	} catch (err) {
		console.error('Ошибка генерации видео:', err);
		throw err;
	}
}
