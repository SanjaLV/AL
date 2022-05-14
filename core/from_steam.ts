import AL, {Warrior, Priest, PingCompensatedCharacter, Entity, ItemName, IPosition} from "alclient"
import assert from 'assert';

function get_player(player, name) {
    return player.players.get(name);
}

enum STATES {
    ZERO,
    FIGHT,
    FARM_SPOT,
    TAUNT,
}

const MY_NAMES = ["GHTank", "GHRogue", "GHHeal", "GHMage", "GHMerc"];
const KILL_TO_NEXT = 100;
const GO_SHOPING_AFTER = 7;
const SPECIALS = ["cutebee", "goldenbat", "phoenix", "mvampire", "wabbit"];

function get_target(player, type) {
    let best = undefined;
    let dist = 99999;
    
    for (const [key, value] of player.entities.entries()) {

        // IF PARTY IS TARGETED, KILL THAT INSTEAD!
        if (value.target !== undefined && MY_NAMES.includes(value.target)) return value;

        if (SPECIALS.includes(value.type)) {
            console.log(value.type);
            return value;
        }

        // Cannot go there!
        if (AL.Pathfinder.canWalkPath(player, value) == false) continue;

        if (value.type !== type) continue;
        const cdist = AL.Tools.distance(player, value);

        if (cdist < dist) {
            dist = cdist;
            best = value;
        }
    }

    //console.log("Found with distance " + dist);
    return best;
}

let cur_hunt_index = 0;
let iteration_count = 0;

const HUNT_CHOICES = ["cave3", "cave2", "croc"] //, "armadillo", "snake"]; //, "bees1", "bees2", "bees3", "cave_dracula", ] // , "cave"];


function get_pull_location(s: string) {
    if (s == "cave_dracula") return [-72, -1161];
    else if (s === "cave") return [-22, -333];
    else if (s == "cave2") return [1247, -26];
    else if (s == "cave3") return [167, -1163]; // TODO
    else if (s === "armadillo") return [538, 1720];
    else if (s === "croc") return [810, 1708];
    else if (s === "snake") return [-52, 1917];
    else if (s === "bees1") return [163, 1509];
    else if (s === "bees2") return [530, 1100];
    else if (s === "bees3") return [615, 720];
    else {
        console.log("UNIMPLEMENTED! " + s);
        return undefined;
    }
}

function get_monster_type(s: string) {
    if (s == "cave_dracula") return "mvampire";
    else if (s === "cave" || s === "cave2" || s === "cave3") return "bat";
    else if (s === "armadillo") return "armadillo";
    else if (s === "croc") return "croc";
    else if (s === "snake") return "snake";
    else if (s === "bees1") return "bee";
    else if (s === "bees2") return "bee";
    else if (s === "bees3") return "bee";
    else {
        console.log("UNIMPLEMENTED! " + s);
        return undefined;
    }
}

let HUNT_LOC = "croc";
let pull_location = undefined; 
let MONSTER_TYPE = undefined; 


function update_location(new_location) {
    HUNT_LOC = new_location;
    pull_location = get_pull_location(new_location);
    MONSTER_TYPE = get_monster_type(new_location);
    
    console.log("cur_hunt_index = " + cur_hunt_index);
    console.log("Starting to farm " + new_location);
    console.log("pull_location " + pull_location);
    console.log("MONSTER_TYPE " + MONSTER_TYPE);
}

update_location(HUNT_LOC);

const TICK_RATE = 1000 / 16;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

class Party {
    target: string;
    target_name: string;

    kills: number;
    do_not_engage: boolean;
    use_hp_potions_threshold: number;

    death_count: Map<string, number>;
    kills_count: Map<string, number>;

    members: Array<PingCompensatedCharacter>;

    constructor() {
        this.target = undefined;
        this.target_name = "error";
        this.use_hp_potions_threshold = 250;
        this.kills = 0;
        this.do_not_engage = false;
        this.death_count = new Map<string, number>();
        this.kills_count = new Map<string, number>();
        this.members = new Array<PingCompensatedCharacter>();
    }

    public set_do_not_engage(val: boolean) {
        this.do_not_engage = val;
    }

    public get_target() {
        if (this.do_not_engage) return undefined;
        return this.target;
    }

    private update_kill_count() {
        const name = this.target_name;
        if (this.kills_count.has(name)) {
            this.kills_count.set(name, this.kills_count.get(name) + 1);
        }
        else {
            this.kills_count.set(name, 1);
        }
    }

    public set_target(id, name) {
        this.target = id;
        this.target_name = name;
    }

    public killed() {
        this.kills += 1;
        this.update_kill_count();
        this.target_name = "error";
        
        if (this.kills >= KILL_TO_NEXT * iteration_count) {
            this.set_do_not_engage(true);
        }
    }

    public party_member_died(name) {
        if (this.death_count.has(name)) {
            this.death_count.set(name, this.death_count.get(name) + 1);
        }
        else {
            this.death_count.set(name, 1);
        }
    }

    public register_party_member(member: PingCompensatedCharacter) {
        this.members.push(member);

        if (member instanceof Priest) {
            this.use_hp_potions_threshold = Math.min(1000, member.attack * 1.5);
            console.log("Setting party HP potion threshold to " + this.use_hp_potions_threshold);
        }
    }

    public get_members() {
        return this.members;
    }
}

async function HELPER_loot(bot: PingCompensatedCharacter) {
    for (const [id, chest] of bot.chests) {
        let looted = false;
        for (let retry = 0; retry < 20; retry++) {
            try {
                if (AL.Tools.distance(bot, chest) > 800) {
                    await bot.move(chest.x, chest.y);
                }
                await bot.openChest(id);
                looted = true;
                break;
            }
            catch (e) {
                console.log("HELPER_loot " + e);
                await delay(1000);
            }
        } // retry

        if (looted == false) {
            console.log("UNABLE TO LOOT!!!!!!!!!!!!!!!!!!!!!!");
            console.log(chest);
            await delay(1000);
        }
    } // for chest
}

function HELPER_potions(bot: PingCompensatedCharacter) {
    if (bot.rip) return;

    const can_use = !bot.isOnCooldown("regen_hp");
    if (can_use == false) return;

    const missing_hp = bot.max_hp - bot.hp;
    const missing_mp = bot.max_mp - bot.mp;
    const hpot0 = bot.locateItem("hpot0")
    const mpot0 = bot.locateItem("mpot0")
    

    function refil_mana() {
        if (missing_mp >= 200 && mpot0 !== undefined) {
            bot.useMPPot(mpot0).catch( () => {} );
        }
        else {
            bot.regenMP().catch( () => {} );
        }

        return true;
    }

    function refil_hp() {
        if (missing_hp >= 200 && hpot0 !== undefined) {
            bot.useHPPot(hpot0).catch( () => {} );
            return true;
        }
        else if (missing_hp >= 50) {
            bot.regenHP().catch( () => {} );
            return true;
        }
        else {
            return false;
        }
    }

    if (bot.mp < 100 && refil_mana()) return;
    if (refil_hp()) return;
    refil_mana();
}

function HELPER_get_init_position(): IPosition {
    if (HUNT_CHOICES[cur_hunt_index] === "croc") {
        return {map: "main", x:806, y:1681};
    }
    else if (HUNT_CHOICES[cur_hunt_index] === "snake") {
        return {map: "main", x: 12, y: 2016};
    }
    else if (HUNT_CHOICES[cur_hunt_index] === "armadillo") {
        return {map: "main", x: 536, y: 1784};
    }
    else if (HUNT_CHOICES[cur_hunt_index] === "bees1") {
        return {map: "main", x: 62, y: 1520};
    }
    else if (HUNT_CHOICES[cur_hunt_index] === "bees2") {
        return {map: "main", x: 420, y: 1138};
    }
    else if (HUNT_CHOICES[cur_hunt_index] === "bees3") {
        return {map: "main", x: 696, y: 820};
    }
    else if (HUNT_CHOICES[cur_hunt_index] === "cave") {
        return {map: "cave", x:-200, y:-450};
    }
    else if (HUNT_CHOICES[cur_hunt_index] === "cave2") {
        return {map: "cave", x: 1247, y: -26};
    }
    else if (HUNT_CHOICES[cur_hunt_index] === "cave3") {
        return {map: "cave", x: 167, y: -1163};
    }
    else if (HUNT_CHOICES[cur_hunt_index] === "cave_dracula") {
        return {map: "cave", x: -72, y: -1161};
    }
    else {
        console.log("UNIMPLEMENTED: " + HUNT_CHOICES[cur_hunt_index]);
        return undefined;
    }
}

class BaseBot<BotType extends PingCompensatedCharacter> {
    move_in_progress: boolean;
    party: Party;
    state: STATES;
    respawn_procedure_done: boolean;

    bot: BotType;

    private setup_party_request_callback() {
        this.bot.socket.on("request", async (data: { name: string }) => {
            try {
                if (MY_NAMES.includes(data.name)) {
                    await this.bot.acceptPartyRequest(data.name)
                    this.log("party accepted " + data.name);
                }
            } catch (e) {
                this.log(e);
            }
        });
    }

    constructor (bot: BotType, party: Party) {
        this.bot = bot;
        this.party = party;
        this.party.register_party_member(bot);
        this.move_in_progress = false;
        this.respawn_procedure_done = false;

        this.setup_party_request_callback();
    }

    public log(s: string) {
        console.log(this.bot.name + ">" + s);
    }

    public async smart_move(pos: IPosition): Promise<boolean> {
        if (this.move_in_progress) return false;

        this.move_in_progress = true;
        let ok = true;
        await this.bot.smartMove(pos).catch( (e) => {
            this.log("fail " + e);
            ok = false;
        } );
        this.move_in_progress = false;
        return ok;
    }

    protected async init() {
        while (this.move_in_progress) {
            this.log("Cannot init, still moving, waiting for 3s");
            await delay(3000);
        }

        this.state = STATES.FARM_SPOT;
        const target_pos = HELPER_get_init_position();

        while (true) {
            try {
                const res = await this.smart_move(target_pos);
                await delay(1000);
                if (res == true) break;
            }
            catch (e) {
                this.log(e);
                await delay(1500);
            }
        }

        this.respawn_procedure_done = false;
        this.log("init done!");
    } // func init

    protected aproach(entity: Entity) {
        this.bot.move(this.bot.x + (entity.x - this.bot.x) / 2,
                      this.bot.y + (entity.y - this.bot.y) / 2).catch( () => {} );
    }

    protected fight(target_entity: Entity) {
        if (target_entity === undefined) return;

        if (AL.Tools.distance(this.bot, target_entity) > this.bot.range) {
            if (AL.Pathfinder.canWalkPath(this.bot, target_entity) == false) {
                this.smart_move(target_entity);
                return;
            }
            this.aproach(target_entity);
        }
        else if (this.bot.isOnCooldown("attack") == false) {
            this.bot.basicAttack(target_entity.id).catch( () => {} );
        }
    }

    protected alert() {
        if (this.bot.hp < this.bot.max_hp / 2) {
            this.log((this.bot.hp / this.bot.max_hp * 100).toFixed(2) + "% hp");
        }
    }

    protected respawn() {
        if (this.respawn_procedure_done == false) {
            this.respawn_procedure_done = true;

            this.log("died!");
            this.party.party_member_died(this.bot.name);

            setTimeout(async () => {
                    this.bot.respawn();
                    await this.init();
                    this.respawn_procedure_done = false;
                    this.log("respawned!");
                }, 17000);
        }
    }

    protected look_for_target() {
        const target = get_target(this.bot, MONSTER_TYPE);
        if (target === undefined) {
            this.init(); // smart move to pull location
            return;
        }
        else {
            this.party.set_target(target.id, target.type);
            this.state = STATES.FIGHT;
            return;
        }
    }

    protected class_specific_main() {
        this.log("class_specific_main is not implemented for BaseBot!"); 
    }

    protected main() {
        if (this.bot === undefined) return;

        if (this.bot.rip) {
            this.respawn();
            return;
        }

        HELPER_potions(this.bot);

        if (this.bot.moving) return;
        if (this.move_in_progress) return;

        HELPER_loot(this.bot);
        this.alert();

        this.class_specific_main();
    }

    public safe_main() {
        try {
            this.main();
        }
        catch (e) {
            this.log(e);
        }
    }

    public async run() {
        if (this.bot.rip == false) {
            await this.init();
        }
    }

} // class BaseBot

class NewDpsBot<BotType extends PingCompensatedCharacter> extends BaseBot<BotType>{
    protected class_specific_main() {
        const target_id = this.party.get_target();
        const target_entity = this.bot.entities.get(target_id);
        if (target_entity === undefined) return;

        if (this.bot.hp < 200 && 
            MONSTER_TYPE === "armadillo") {
            return; // DO NOT FIGHT IF WE ARE LOW!
        }

        this.fight(target_entity);
    }
}

class NewTankBot<BotType extends Warrior> extends BaseBot<BotType> {

    protected class_specific_main() {
        if (this.state == STATES.FARM_SPOT) {
            this.look_for_target();
        }
        else if (this.state == STATES.FIGHT) {
            const target_id = this.party.get_target();

            if (this.party.do_not_engage) return;

            const target_entity = this.bot.entities.get(target_id);
            if (target_entity === undefined) {
                this.state = STATES.ZERO;
            }
            else {
                if (AL.Tools.distance(this.bot, target_entity) < 190 && 
                    MY_NAMES.includes(target_entity.target)) {

                    if (this.bot.isOnCooldown("taunt") == false) {
                        this.bot.taunt(target_id).catch( () => {} );
                    }
                }

                this.fight(target_entity);
            }
        }
        else {
            this.party.killed();
            this.state = STATES.FARM_SPOT;
        }
    }

}

class NewHealBot<BotType extends Priest> extends BaseBot<BotType> {

    private search_for_target_to_heal() {
        const members = this.party.get_members();

        let largest_heal = 0;
        let best = undefined;

        for (let i = 0; i < members.length; i++) {
            const m = members[i];
            if (m.name === this.bot.name) continue; // we cannot self heal
            if (AL.Tools.distance(this.bot, m) > this.bot.range) continue; // out-of-range

            const cur = m.max_hp - m.hp;
            if (cur > largest_heal) {
                largest_heal = cur;
                best = m;
            }
        }

        return (largest_heal > 200) ? best : undefined;
    }

    protected class_specific_main() {

        if (this.bot.isOnCooldown("heal") == false) {
            const heal_target = this.search_for_target_to_heal();
            if (heal_target !== undefined) {
                this.bot.heal(heal_target.name).catch( () => {} );
                return;
            }
        }
        
        const target_id = this.party.get_target();
        const target_entity = this.bot.entities.get(target_id);
        if (target_entity === undefined) return;

        if (this.bot.hp < 200 && 
            MONSTER_TYPE === "armadillo") {
            return; // DO NOT FIGHT IF WE ARE LOW!
        }

        this.fight(target_entity);
    }
}

async function buy_many(bot: PingCompensatedCharacter, item: ItemName, limit: number) {
    const location = bot.locateItem(item);
    let have = 0;
    if (location !== undefined && location !== null) have = bot.items[location].q;

    const need_to_buy = limit - have;
    if (need_to_buy > 0) {
        console.log(bot.name + ">buying " + need_to_buy + " " + item);
        await bot.buy(item, need_to_buy).catch( () => {} );
    }
}

async function HELPER_upgrade(bot: PingCompensatedCharacter) {
    const ITEMS_TO_UPGRADE: Array<ItemName> = ["firestaff", "fireblade"];
    const SCROLL_TO_USE: ItemName = "scroll1";
    const LEVEL_TO_UPGRADE: number = 6;
    const GOLD_TO_LEAVE: number = 500000;

    let retry_cnt = 0;

    while (true) {
        if (bot.gold < GOLD_TO_LEAVE) {
            console.log(bot.name + ">leaving upgrade cuz not enough gold left :(");
            return;
        }

        buy_many(bot, SCROLL_TO_USE, 3);
        const scroll_location = bot.locateItem(SCROLL_TO_USE);
        if (scroll_location === null || scroll_location === undefined) {
            console.log(bot.name + ">failed to buy scrolls :|");
            retry_cnt++;
            await delay(500);
            if (retry_cnt > 10) {
                return;
            }
            else {
                continue;
            }
        }
        
        let found_item = false;

        for (let i = 0; i < bot.items.length; i++) {
            const item = bot.items[i];
            if (item === null || item === undefined) continue;
            if (ITEMS_TO_UPGRADE.includes(item.name) == false) continue;

            if (item.level < LEVEL_TO_UPGRADE) {
                found_item = true;

                console.log(bot.name + ">upgrading " + item.name + " level " + item.level)

                try {
                    const res = bot.upgrade(i, scroll_location);
                    const val = await res;

                    if (val === true) {
                        console.log(bot.name + ">SUCCESS!");
                    }
                    else {
                        console.log(bot.name + ">FAIL!");
                    }
                } catch (e) {
                    console.log(bot.name + ">" + e);
                    await delay(500);
                }
                
                break;
            } // level is small for upgrade
        }
        
        if (found_item === false) break;
    }
}

async function HELPER_shoping(bot: PingCompensatedCharacter) {
    const ITEMS_TO_SELL: Array<ItemName> = ["hpbelt", "hpamulet", "ringsj", "wbook0",
                                            "wshoes", "wgloves", "wcap", "wattire",
                                            "vitearring", "dexearring", "intearring", "strearring",
                                            "mcape"];

    await bot.smartMove("fancypots", { getWithin: AL.Constants.NPC_INTERACTION_DISTANCE / 2 });

    const start_gold = bot.gold;

    for (let i = 0; i < bot.items.length; i++) {
        const item =  bot.items[i];
        if (item === null || item === undefined) continue;
        if (item.level > 0) continue; // Do not sell upped items
        if (ITEMS_TO_SELL.includes(item.name)) {
            console.log(bot.name + ">selling " + item.name);
            await bot.sell(i).catch( () => {} );
        }
    }

    console.log(bot.name + ">SOLD : " + (bot.gold - start_gold));

    

    buy_many(bot, "hpot0", 5000);
    buy_many(bot, "mpot0", 5000);

    for (let retry = 0; retry < 5; retry++) {
        try {
            await bot.smartMove({map:"main", x:-209, y:-147}); // go to updates
            break;
        } catch (e) {
            console.log(bot.name + ">cannot move to upgrade, waiting 1s");
            await delay(1000);
        }
    }

    // upgrade phoenix weapons!
    await HELPER_upgrade(bot);

    let free_cnt = 0;
    for (let i = 0; i < bot.items.length; i++) {
        const item = bot.items[i];
        if (item == null) free_cnt += 1;
    }

    console.log(bot.name + ">EMPTY SPACES " + free_cnt);
}

async function farm_cave(server) {
    const tank  = await AL.Game.startWarrior("GHTank", server[0], server[1]);
    //const rogue = await AL.Game.startRogue("GHRogue", server[0], server[1]);
    const rogue = await AL.Game.startPriest("GHHeal", server[0], server[1]);
    const mage  = await AL.Game.startMage("GHMage", server[0], server[1]);

    const party = new Party();
/*
    const tankBot = new TankBot(tank, party);
    const dpsBot  = new DpsBot(rogue, party);
    const dpsBotMage = new DpsBot(mage, party);
*/

    const tankBot = new NewTankBot<Warrior>(tank, party);
    // const dpsBot = new NewDpsBot<PingCompensatedCharacter>(rogue, party);
    const dpsBot = new NewHealBot<Priest>(rogue, party);
    const dpsBotMage = new NewDpsBot<PingCompensatedCharacter>(mage, party);

    // Brain logic
    setInterval(() => {
        tankBot.safe_main();
        dpsBot.safe_main();
        dpsBotMage.safe_main();
    }, TICK_RATE);

    let last_gold = tank.gold + rogue.gold + mage.gold;
    let tot_gold = 0;
    let last_time = Date.now();
    const start_time = Date.now();
    
    function print_stat() {
        
        const now = new Date();
        const time = now.getHours() + ":" + now.getMinutes() + ":" + now.getSeconds();

        const cur_gold = tank.gold + rogue.gold + mage.gold;
        const new_gold = cur_gold - last_gold;
        tot_gold += new_gold;

        const this_segment = (Date.now() - last_time) / 1000 / 60; // in minutes????
        const tot_time = (Date.now() - start_time) / 1000 / 60;

        console.log("###################################");
        console.log(time);
        console.log("Last segment got: " + new_gold);
        console.log("Total got: " + tot_gold);
        console.log("Segment length: " + this_segment.toFixed(2) + " [ " + tot_time.toFixed(2) + " ]");
        console.log("total kills: " + party.kills);
        
        console.log("Kills:")
        for (const [key, value] of party.kills_count) {
            console.log(key + ": " + value);
        }
        console.log();
        console.log("Death:");
        for (const [key, value] of party.death_count) {
            console.log(key + ": " + value);
        }
        console.log("###################################");

        last_gold = cur_gold;
        last_time = Date.now();
    }

    cur_hunt_index = 0;
    let runs_competed = 0;

    setInterval( () => {
        for (let m of party.get_members()) {
            if (!m.socket || m.socket.disconnected || !m.ready) {
                console.log(m.name + "> DISCONNECT!");
                process.exit(1);
            }
        }
    }, 60000); // every minute

    async function go_shoping() {
        console.log("GO SHOPING");
        let ok = false;

        for (let retry = 0; retry < 5; retry++) {
            try {
                await Promise.all ([HELPER_shoping(tank),
                                    HELPER_shoping(rogue),
                                    HELPER_shoping(mage)]);
                ok = true;
                break;
            } catch (e) {
                console.log("FAILED TO HELPER_SHOPING " + e);
                await delay(500);
            }
        }

        assert(ok);
        runs_competed = 0;
    }

    //await go_shoping();

    while (true) {
        iteration_count += 1;
        print_stat();
        update_location(HUNT_CHOICES[cur_hunt_index]);

        await Promise.all([tankBot.run(),
                           dpsBot.run(),
                           dpsBotMage.run()]);
        await rogue.sendPartyRequest("GHTank");
        await mage.sendPartyRequest("GHTank");

        party.set_do_not_engage(false);

        while (party.kills < KILL_TO_NEXT * iteration_count) {
            await delay(1000);
        }

        cur_hunt_index += 1;
        if (cur_hunt_index >= HUNT_CHOICES.length) {
            cur_hunt_index = 0;
            runs_competed += 1;
            
            if (runs_competed === GO_SHOPING_AFTER) {
                await go_shoping();
            }
        }
    }
}

async function run() {
    await Promise.all([AL.Game.loginJSONFile("../credentials.json"), AL.Game.getGData(true)])
    await AL.Pathfinder.prepare(AL.Game.G)

    farm_cave(["EU", "II"]);
}

run()
