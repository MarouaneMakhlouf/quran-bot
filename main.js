const { Client, GatewayIntentBits, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, REST, Routes } = require('discord.js');
const { SlashCommandBuilder } = require('@discordjs/builders');
const { joinVoiceChannel, createAudioPlayer, createAudioResource } = require('@discordjs/voice');
const axios = require('axios');
const prism = require('prism-media');
const config = require('./json/config.json');
const surahInfo = require('./json/surahinfo.json');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const userStates = new Map();

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);

  // Register slash commands
  const rest = new REST({ version: '10' }).setToken(config.token);

  (async () => {
    try {
      console.log('Started refreshing application (/) commands.');

      await rest.put(Routes.applicationCommands(client.user.id), {
        body: [
          new SlashCommandBuilder()
            .setName('support')
            .setDescription('Get the support server link')
            .toJSON(),
        ],
      });

      console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
      console.error(error);
    }
  })();
});

const playNext = async (userId) => {
  const userState = userStates.get(userId);
  if (!userState || userState.isPaused) return;

  const surah = surahInfo.find(s => s.surah === userState.surahNo);
  if (!surah) {
    await userState.interaction.reply({
      content: 'حدث خطأ: لم يتم العثور على السورة.',
      ephemeral: true
    });
    return;
  }

  if (userState.currentAyah > surah.ayahtcount) {
    userState.connection.destroy();
    userStates.delete(userId);
    if (userState.statusMessage) {
      await userState.statusMessage.edit({
        content: 'تم الانتهاء من السورة.',
        components: []
      });
      // حذف الرسالة بعد الانتهاء
      await userState.statusMessage.delete();
    }
    return;
  }

  try {
    const audioUrl = `https://quranaudio.pages.dev/1/${userState.surahNo}_${userState.currentAyah}.mp3`;

    const response = await axios({
      method: 'get',
      url: audioUrl,
      responseType: 'stream',
    });

    const audioStream = response.data.pipe(new prism.FFmpeg({
      args: [
        '-analyzeduration', '0',
        '-loglevel', '0',
        '-f', 'mp3',
        '-ac', '2',
        '-ar', '44100',
      ],
    }));

    const resource = createAudioResource(audioStream);
    userState.player.play(resource);

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('تشغيل القرآن الكريم')
      .setDescription(`الآن تشغيل الآية ${userState.currentAyah} من سورة ${surah.name}`)
      .setThumbnail('https://cdn.discordapp.com/attachments/1183742759539060776/1276573102154846248/BANNER_00000.jpg?ex=66ca04d9&is=66c8b359&hm=7b6497f4897805c73f0e83eaad44a6ffcf30884b7fab3c65ec075fd5fdfc319b&')
      .setFooter({ text: 'مبرمج البوت: مروان', iconURL: 'https://cdn.discordapp.com/attachments/1183742759539060776/1276573102154846248/BANNER_00000.jpg?ex=66ca04d9&is=66c8b359&hm=7b6497f4897805c73f0e83eaad44a6ffcf30884b7fab3c65ec075fd5fdfc319b&' });

    if (!userState.statusMessage) {
      userState.statusMessage = await userState.interaction.reply({
        embeds: [embed],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('previous').setEmoji('◀️').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('playPause').setEmoji('⏯️').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('next').setEmoji('▶️').setStyle(ButtonStyle.Primary)
          )
        ]
      });
    } else {
      await userState.statusMessage.edit({
        embeds: [embed],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('previous').setEmoji('◀️').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('playPause').setEmoji('⏯️').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('next').setEmoji('▶️').setStyle(ButtonStyle.Primary)
          )
        ]
      });
    }

    userState.currentAyah++;

    // Log current state for debugging
    console.log(`Playing ayah ${userState.currentAyah} of surah ${userState.surahNo}`);

  } catch (error) {
    console.error('Error fetching or playing the audio:', error);
    await userState.interaction.reply({
      content: 'حدث خطأ أثناء تشغيل الصوت.',
      ephemeral: true
    });
  }
};


client.on('messageCreate', async (message) => {
  if (message.content === '!quran') {
    const maxOptions = 25;
    let options = surahInfo.map(surah => ({
      label: surah.name,
      value: surah.surah.toString(),
    }));

    const rows = [];
    while (options.length > 0) {
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`select_surah_${rows.length}`)
        .setPlaceholder('اختر سورة')
        .addOptions(options.splice(0, maxOptions));

      const row = new ActionRowBuilder().addComponents(selectMenu);
      rows.push(row);
    }

    await message.reply({
      content: 'يرجى اختيار سورة لتشغيلها:',
      components: rows,
    });
  }
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_surah_')) {
    const surahNo = parseInt(interaction.values[0], 10);
    const surah = surahInfo.find(s => s.surah === surahNo);

    if (!surah) {
      return interaction.reply({
        content: 'لم يتم العثور على السورة!',
        ephemeral: true
      });
    }

    const voiceChannel = interaction.member?.voice.channel;
    if (!voiceChannel) {
      return interaction.reply({
        content: 'يجب أن تكون في قناة صوتية لتشغيل القران!',
        ephemeral: true
      });
    }

    const botVoiceChannel = interaction.guild.members.me?.voice.channel;
    if (botVoiceChannel && botVoiceChannel.members.size > 1) {
      return interaction.reply({
        content: 'البوت مشغول حاليًا في قناة صوتية مع مستخدمين. يرجى المحاولة لاحقًا.',
        ephemeral: true
      });
    }

    userStates.set(interaction.user.id, {
      surahNo,
      currentAyah: 1,
      player: createAudioPlayer(),
      connection: joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      }),
      interaction,
      statusMessage: null,
      isPaused: false
    });

    const { player, connection } = userStates.get(interaction.user.id);
    connection.subscribe(player);

    player.on('idle', () => {
      playNext(interaction.user.id);
    });

    playNext(interaction.user.id);
  }

  if (interaction.isButton()) {
    const { customId } = interaction;
    const userState = userStates.get(interaction.user.id);

    if (!userState) {
      return interaction.reply({
        content: 'يجب عليك بدء التشغيل أولاً!',
        ephemeral: true
      });
    }

    const { player, connection } = userState;
    const totalSurahs = surahInfo.length;

    switch (customId) {
      case 'playPause':
        if (player.state.status === 'paused') {
          player.unpause();
          userState.isPaused = false;
          await interaction.reply({
            content: 'تم استئناف التشغيل.',
            ephemeral: true
          });
        } else {
          player.pause();
          userState.isPaused = true;
          await interaction.reply({
            content: 'تم إيقاف التشغيل مؤقتًا.',
            ephemeral: true
          });
        }
        break;
      case 'stop':
        player.stop();
        connection.destroy();
        if (userState.statusMessage) {
          await userState.statusMessage.delete(); // حذف لوحة التحكم بعد الإيقاف
        }
        userStates.delete(interaction.user.id);
        await interaction.reply({
          content: 'تم إيقاف التشغيل وتدمير الاتصال.',
          ephemeral: true
        });
        break;
      case 'next':
        userState.surahNo++;
        if (userState.surahNo > totalSurahs) {
          userState.surahNo = 1;
        }
        userState.currentAyah = 1;
        await playNext(interaction.user.id);
        await interaction.reply({
          content: `انتقلت إلى سورة ${surahInfo.find(s => s.surah === userState.surahNo).name}`,
          ephemeral: true
        });
        break;
      case 'previous':
        userState.surahNo--;
        if (userState.surahNo < 1) {
          userState.surahNo = totalSurahs;
        }
        userState.currentAyah = 1;
        await playNext(interaction.user.id);
        await interaction.reply({
          content: `عدت إلى سورة ${surahInfo.find(s => s.surah === userState.surahNo).name}`,
          ephemeral: true
        });
        break;
      default:
        await interaction.reply({
          content: 'إجراء غير معروف.',
          ephemeral: true
        });
        break;
    }
  }

  if (interaction.isCommand() && interaction.commandName === 'support') {
    await interaction.reply({embeds: [{
      title: 'رابط سيرفرات الدعم: ',
      description: 'Wick studio: https://discord.gg/wicks \n Nextroy team: https://discord.gg/xHTnGkzs9w',
      color: 0x00ff99
    }],
      ephemeral: false // or true based on your preference
    });
  }
});

client.login(config.token);
