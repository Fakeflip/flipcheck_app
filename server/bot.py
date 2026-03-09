"""
Flipcheck Support Bot
Postet das Ticket-Embed und öffnet private Ticket-Channels.

Run: python bot.py
Env: DISCORD_BOT_TOKEN
"""
import os
import discord
from discord.ext import commands
from dotenv import load_dotenv

load_dotenv()

BOT_TOKEN         = os.environ.get("DISCORD_BOT_TOKEN", "")
SUPPORT_CHANNEL_ID = 1458222196592869517   # Kanal wo das Embed gepostet wird
TICKET_CATEGORY_ID = 1458220649041498224   # Kategorie wo Tickets erstellt werden

# ── Embed ─────────────────────────────────────────────────────────────────────

SUPPORT_EMBED = discord.Embed(
    title="Flipcheck Support",
    description="Klick auf **Ticket erstellen**, um privaten Support zu bekommen.",
    color=0x6366F1,
)
SUPPORT_EMBED.set_footer(text="Flipcheck • Support System")

# ── Views (persistent) ────────────────────────────────────────────────────────

class TicketView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(
        label="Ticket erstellen",
        emoji="🎫",
        style=discord.ButtonStyle.primary,
        custom_id="fc_create_ticket",
    )
    async def create_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        guild    = interaction.guild
        user     = interaction.user
        category = guild.get_channel(TICKET_CATEGORY_ID)

        # Prüfen ob bereits offenes Ticket existiert
        if category:
            for ch in category.channels:
                if isinstance(ch, discord.TextChannel) and ch.topic and str(user.id) in ch.topic:
                    await interaction.response.send_message(
                        f"Du hast bereits ein offenes Ticket: {ch.mention}",
                        ephemeral=True,
                    )
                    return

        overwrites = {
            guild.default_role: discord.PermissionOverwrite(view_channel=False),
            user: discord.PermissionOverwrite(
                view_channel=True,
                send_messages=True,
                read_message_history=True,
                attach_files=True,
            ),
        }

        # Support-Rolle Zugriff geben falls gesetzt
        support_role_id = int(os.environ.get("DISCORD_SUPPORT_ROLE_ID", "0"))
        if support_role_id:
            support_role = guild.get_role(support_role_id)
            if support_role:
                overwrites[support_role] = discord.PermissionOverwrite(
                    view_channel=True,
                    send_messages=True,
                    read_message_history=True,
                )

        ticket_channel = await guild.create_text_channel(
            name=f"ticket-{user.name.lower().replace(' ', '-')}",
            category=category,
            overwrites=overwrites,
            topic=f"Support Ticket | user_id:{user.id}",
        )

        welcome = discord.Embed(
            title="Support Ticket geöffnet",
            description=(
                f"Hallo {user.mention}! 👋\n\n"
                "Beschreibe dein Problem so genau wie möglich "
                "und wir melden uns schnellstmöglich."
            ),
            color=0x6366F1,
        )
        welcome.set_footer(text="Flipcheck • Support System")

        await ticket_channel.send(
            content=user.mention,
            embed=welcome,
            view=CloseTicketView(),
        )

        await interaction.response.send_message(
            f"Dein Ticket wurde erstellt: {ticket_channel.mention}",
            ephemeral=True,
        )
        print(f"[BOT] Ticket erstellt: #{ticket_channel.name} für {user}")


class CloseTicketView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(
        label="Ticket schließen",
        emoji="🔒",
        style=discord.ButtonStyle.danger,
        custom_id="fc_close_ticket",
    )
    async def close_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_message("Ticket wird geschlossen…")
        await interaction.channel.delete()
        print(f"[BOT] Ticket geschlossen: #{interaction.channel.name}")


# ── Bot ───────────────────────────────────────────────────────────────────────

intents = discord.Intents.default()
intents.guilds = True
intents.members = True

bot = discord.Client(intents=intents)


@bot.event
async def on_ready():
    print(f"[BOT] Eingeloggt als {bot.user} ({bot.user.id})")

    # Persistent views registrieren
    bot.add_view(TicketView())
    bot.add_view(CloseTicketView())

    # Support-Embed posten falls noch nicht vorhanden
    channel = bot.get_channel(SUPPORT_CHANNEL_ID)
    if not channel:
        print(f"[BOT] ⚠ Support-Channel {SUPPORT_CHANNEL_ID} nicht gefunden")
        return

    # Prüfen ob Bot-Nachricht bereits existiert
    async for msg in channel.history(limit=20):
        if msg.author == bot.user and msg.embeds:
            print("[BOT] Support-Embed bereits vorhanden — übersprungen")
            return

    await channel.send(embed=SUPPORT_EMBED, view=TicketView())
    print(f"[BOT] Support-Embed gepostet in #{channel.name}")


if __name__ == "__main__":
    if not BOT_TOKEN:
        print("[BOT] ✗ DISCORD_BOT_TOKEN fehlt!")
        exit(1)
    bot.run(BOT_TOKEN)
