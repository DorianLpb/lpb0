
const {
  Client,
  GatewayIntentBits,
  ChannelType,
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const {
  joinVoiceChannel,
  entersState,
  VoiceConnectionStatus
} = require("@discordjs/voice");

const TOKEN = process.env.TOKEN;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// ---------- COMANDOS ----------
const slashCommands = [
  new SlashCommandBuilder()
    .setName("voice-join")
    .setDescription("Entrar o salir de un canal de voz")
    .addChannelOption(opt =>
      opt.setName("canal")
        .setDescription("Canal de voz")
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt.setName("stop")
        .setDescription("Salir del canal de voz")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("bot")
    .setDescription("Comandos del bot")
    .addSubcommand(sub =>
      sub.setName("say")
        .setDescription("Enviar mensajes e imágenes")
        .addStringOption(opt =>
          opt.setName("mensaje")
            .setDescription("Texto que enviará el bot (opcional)")
            .setRequired(false)
            .setMaxLength(2000)
        )
        .addAttachmentOption(opt =>
          opt.setName("imagen")
            .setDescription("Imagen que enviará el bot (opcional)")
            .setRequired(false)
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
];

// ---------- SISTEMA DE VOZ ----------
let activeConnection = null;
let targetChannelId = null;

async function joinVoicePersistent(channel) {
  if (!channel) return null;

  targetChannelId = channel.id;

  if (activeConnection) {
    const old = activeConnection;
    activeConnection = null;
    try { old.destroy(); } catch (e) {}
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: true
  });

  activeConnection = connection;

  console.log(`Conectado al canal: ${channel.name}`);

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5000)
      ]);
    } catch (e) {
      try { connection.destroy(); } catch (err) {}
    }
  });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    if (connection !== activeConnection) return;
    activeConnection = null;
    if (targetChannelId) setTimeout(rejoin, 5000);
  });

  return connection;
}

async function rejoin() {
  if (!targetChannelId || activeConnection) return;

  const ch = await client.channels.fetch(targetChannelId).catch(() => null);

  if (ch && ch.isVoiceBased()) {
    console.log("Reconectando al canal...");
    joinVoicePersistent(ch);
  } else {
    setTimeout(rejoin, 30000);
  }
}

async function leaveVoice() {
  targetChannelId = null;

  if (activeConnection) {
    const old = activeConnection;
    activeConnection = null;
    try { old.destroy(); } catch (e) {}
  }
}

// ---------- ARRANQUE ----------
client.once("ready", async () => {
  console.log(`Bot listo como ${client.user.tag}`);

  try {
    await client.application.commands.set(slashCommands);
    console.log("Comandos registrados correctamente.");
  } catch (e) {
    console.error("Error registrando comandos:", e);
  }

  const id = process.env.VOICE_CHANNEL_ID;

  if (id) {
    const ch = await client.channels.fetch(id).catch(() => null);

    if (ch && ch.isVoiceBased()) {
      await joinVoicePersistent(ch);
    } else {
      console.error("VOICE_CHANNEL_ID no es válido.");
    }
  }
});

// ---------- INTERACCIONES ----------
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // /BOT SAY
  if (interaction.commandName === "bot") {
    if (interaction.options.getSubcommand() === "say") {
      const mensaje = interaction.options.getString("mensaje");
      const imagen = interaction.options.getAttachment("imagen");

      if (!mensaje && !imagen) {
        return interaction.reply({
          content: "Debes proporcionar un mensaje, una imagen o ambos.",
          ephemeral: true
        });
      }

      if (imagen && !imagen.contentType?.startsWith("image/")) {
        return interaction.reply({
          content: "El archivo adjunto debe ser una imagen.",
          ephemeral: true
        });
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        await interaction.channel.send({
          content: mensaje || undefined,
          files: imagen ? [imagen.url] : [],
          allowedMentions: { parse: [] }
        });

        return interaction.editReply("¡Mensaje enviado correctamente!");
      } catch (error) {
        console.error("Error enviando mensaje:", error);
        return interaction.editReply(
          "No pude enviar el contenido. Revisa mis permisos."
        );
      }
    }
  }

  // /VOICE-JOIN
  if (interaction.commandName === "voice-join") {
    await interaction.deferReply();

    const stop = interaction.options.getBoolean("stop");

    if (stop) {
      await leaveVoice();
      return interaction.editReply("Salí del canal de voz.");
    }

    let channel = interaction.options.getChannel("canal");

    if (!channel && interaction.member?.voice?.channel) {
      channel = interaction.member.voice.channel;
    }

    if (!channel ||
      (channel.type !== ChannelType.GuildVoice &&
       channel.type !== ChannelType.GuildStageVoice)) {
      return interaction.editReply(
        "Menciona un canal de voz o únete a uno primero."
      );
    }

    await joinVoicePersistent(channel);

    return interaction.editReply(
      `Conectado a **${channel.name}**. Me quedaré hasta que uses /voice-join stop: true.`
    );
  }
});

process.on("unhandledRejection", err =>
  console.error("unhandledRejection:", err)
);

process.on("uncaughtException", err =>
  console.error("uncaughtException:", err)
);

client.login(TOKEN);
