// ============================================================
// BOT 2 - Solo hace una cosa: entrar a un canal de voz y quedarse.
// Sin prefijo, sin otros comandos. Único comando: /voice-join
//
// Variables de entorno en Railway:
//   TOKEN             -> token del segundo bot
//   VOICE_CHANNEL_ID  -> (opcional) ID del canal al que entra solo al arrancar
// ============================================================

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

// ---------- Comando slash (el único) ----------
const slashCommands = [
  new SlashCommandBuilder()
    .setName("voice-join")
    .setDescription("El bot se une a un canal de voz y se queda (administrador)")
    .addChannelOption(opt =>
      opt.setName("canal")
        .setDescription("Canal de voz al que unirse")
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt.setName("stop")
        .setDescription("true para sacar al bot del canal de voz")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
];

// ---------- Lógica de voz: entrar, quedarse y reconectar ----------
let activeConnection = null;
let targetChannelId = null;

async function joinVoicePersistent(channel) {
  if (!channel) return null;
  targetChannelId = channel.id;

  // Cerrar la conexión anterior sin que dispare la reconexión automática
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
  console.log(`Conectado al canal de voz: ${channel.name} (${channel.guild.name})`);

  // Si se desconecta, esperar a ver si Discord lo reconecta solo;
  // si no, destruir la conexión para que se vuelva a crear.
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
      ]);
    } catch (e) {
      try { connection.destroy(); } catch (err) {}
    }
  });

  // Si la conexión se destruyó sin que tú lo pidieras, volver a entrar
  connection.on(VoiceConnectionStatus.Destroyed, () => {
    if (connection !== activeConnection) return;
    activeConnection = null;
    if (targetChannelId) setTimeout(rejoin, 5_000);
  });

  return connection;
}

async function rejoin() {
  if (!targetChannelId || activeConnection) return;
  const ch = await client.channels.fetch(targetChannelId).catch(() => null);
  if (ch && ch.isVoiceBased()) {
    console.log("Reconectando al canal de voz...");
    joinVoicePersistent(ch);
  } else {
    // No se pudo obtener el canal (puede ser un fallo de red): reintentar luego
    setTimeout(rejoin, 30_000);
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

// ---------- Arranque ----------
client.once("ready", async () => {
  console.log(`Bot listo como ${client.user.tag}`);

  try {
    await client.application.commands.set(slashCommands);
    console.log("Comando /voice-join registrado.");
  } catch (e) {
    console.error("Error registrando comandos slash:", e);
  }

  // Entrar solo al canal indicado en VOICE_CHANNEL_ID
  const id = process.env.VOICE_CHANNEL_ID;
  if (id) {
    const ch = await client.channels.fetch(id).catch(() => null);
    if (ch && ch.isVoiceBased()) await joinVoicePersistent(ch);
    else console.error("VOICE_CHANNEL_ID no es un canal de voz valido.");
  }
});

// ---------- Handler del comando ----------
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "voice-join") return;

  await interaction.deferReply();

  const stop = interaction.options.getBoolean("stop");
  if (stop) {
    await leaveVoice();
    return interaction.editReply({ content: "Sali del canal de voz." });
  }

  let channel = interaction.options.getChannel("canal");
  if (!channel && interaction.member?.voice?.channel) channel = interaction.member.voice.channel;
  if (!channel || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)) {
    return interaction.editReply({ content: "Menciona un canal de voz o unete a uno primero." });
  }

  await joinVoicePersistent(channel);
  return interaction.editReply({
    content: `Conectado a **${channel.name}**. Me quedare hasta que uses /voice-join stop: true.`
  });
});

process.on("unhandledRejection", err => console.error("unhandledRejection:", err));
process.on("uncaughtException", err => console.error("uncaughtException:", err));

client.login(TOKEN);
