export class Position {
    static __wrap(ptr) {
        const obj = Object.create(Position.prototype);
        obj.__wbg_ptr = ptr;
        PositionFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PositionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_position_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get x() {
        const ret = wasm.__wbg_get_position_x(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get y() {
        const ret = wasm.__wbg_get_position_y(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} arg0
     */
    set x(arg0) {
        wasm.__wbg_set_position_x(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set y(arg0) {
        wasm.__wbg_set_position_y(this.__wbg_ptr, arg0);
    }
}
if (Symbol.dispose) Position.prototype[Symbol.dispose] = Position.prototype.free;

export class TacticalEngine {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        TacticalEngineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_tacticalengine_free(ptr, 0);
    }
    /**
     * @param {string} team
     * @returns {any}
     */
    ai_decide(team) {
        const ptr0 = passStringToWasm0(team, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.tacticalengine_ai_decide(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    calculate_awareness() {
        const ret = wasm.tacticalengine_calculate_awareness(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    check_victory() {
        const ret = wasm.tacticalengine_check_victory(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Drain all pending game events. Call this after each operation to consume events.
     * @returns {any}
     */
    drain_events() {
        const ret = wasm.tacticalengine_drain_events(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {number} ax
     * @param {number} ay
     * @param {number} tx
     * @param {number} ty
     * @returns {any}
     */
    execute_attack(ax, ay, tx, ty) {
        const ret = wasm.tacticalengine_execute_attack(this.__wbg_ptr, ax, ay, tx, ty);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_all_units() {
        const ret = wasm.tacticalengine_get_all_units(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * BFS attack range that cannot pass through blocking terrain.
     * @param {number} x
     * @param {number} y
     * @returns {Position[]}
     */
    get_attack_range(x, y) {
        const ret = wasm.tacticalengine_get_attack_range(this.__wbg_ptr, x, y);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {any}
     */
    get_board_info() {
        const ret = wasm.tacticalengine_get_board_info(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Dijkstra-based movable range respecting terrain costs.
     * @param {number} x
     * @param {number} y
     * @returns {Position[]}
     */
    get_movable_range(x, y) {
        const ret = wasm.tacticalengine_get_movable_range(this.__wbg_ptr, x, y);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {string}
     */
    get_phase() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.tacticalengine_get_phase(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {number}
     */
    get_turn() {
        const ret = wasm.tacticalengine_get_turn(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} x
     * @param {number} y
     * @returns {any}
     */
    get_unit_at(x, y) {
        const ret = wasm.tacticalengine_get_unit_at(this.__wbg_ptr, x, y);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {number} fx
     * @param {number} fy
     * @param {number} tx
     * @param {number} ty
     */
    move_unit(fx, fy, tx, ty) {
        const ret = wasm.tacticalengine_move_unit(this.__wbg_ptr, fx, fy, tx, ty);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {string} grid_type
     * @param {number} width
     * @param {number} height
     */
    constructor(grid_type, width, height) {
        const ptr0 = passStringToWasm0(grid_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.tacticalengine_new(ptr0, len0, width, height);
        this.__wbg_ptr = ret;
        TacticalEngineFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    next_turn() {
        wasm.tacticalengine_next_turn(this.__wbg_ptr);
    }
    /**
     * @param {string} id
     * @param {string} name
     * @param {string} team
     * @param {number} x
     * @param {number} y
     * @param {number} hp
     * @param {number} max_hp
     * @param {number} mp
     * @param {number} max_mp
     * @param {number} attack
     * @param {number} defense
     * @param {number} speed
     * @param {number} move_range
     * @param {number} attack_range
     */
    place_unit(id, name, team, x, y, hp, max_hp, mp, max_mp, attack, defense, speed, move_range, attack_range) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(team, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.tacticalengine_place_unit(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, x, y, hp, max_hp, mp, max_mp, attack, defense, speed, move_range, attack_range);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} x
     * @param {number} y
     */
    remove_unit(x, y) {
        const ret = wasm.tacticalengine_remove_unit(this.__wbg_ptr, x, y);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} x
     * @param {number} y
     * @param {string} terrain_type
     */
    set_terrain(x, y, terrain_type) {
        const ptr0 = passStringToWasm0(terrain_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.tacticalengine_set_terrain(this.__wbg_ptr, x, y, ptr0, len0);
    }
    start_battle() {
        wasm.tacticalengine_start_battle(this.__wbg_ptr);
    }
}
if (Symbol.dispose) TacticalEngine.prototype[Symbol.dispose] = TacticalEngine.prototype.free;
export function __wbg_Error_bce6d499ff0a4aff(arg0, arg1) {
    const ret = Error(getStringFromWasm0(arg0, arg1));
    return ret;
}
export function __wbg_String_8564e559799eccda(arg0, arg1) {
    const ret = String(arg1);
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}
export function __wbg___wbindgen_is_string_dde0fd9020db4434(arg0) {
    const ret = typeof(arg0) === 'string';
    return ret;
}
export function __wbg___wbindgen_throw_9c31b086c2b26051(arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1));
}
export function __wbg_new_02d162bc6cf02f60() {
    const ret = new Object();
    return ret;
}
export function __wbg_new_070df68d66325372() {
    const ret = new Map();
    return ret;
}
export function __wbg_new_310879b66b6e95e1() {
    const ret = new Array();
    return ret;
}
export function __wbg_position_new(arg0) {
    const ret = Position.__wrap(arg0);
    return ret;
}
export function __wbg_random_a8dfe52b70cb65a5() {
    const ret = Math.random();
    return ret;
}
export function __wbg_set_6be42768c690e380(arg0, arg1, arg2) {
    arg0[arg1] = arg2;
}
export function __wbg_set_78ea6a19f4818587(arg0, arg1, arg2) {
    arg0[arg1 >>> 0] = arg2;
}
export function __wbg_set_facb7a5914e0fa39(arg0, arg1, arg2) {
    const ret = arg0.set(arg1, arg2);
    return ret;
}
export function __wbindgen_cast_0000000000000001(arg0) {
    // Cast intrinsic for `F64 -> Externref`.
    const ret = arg0;
    return ret;
}
export function __wbindgen_cast_0000000000000002(arg0) {
    // Cast intrinsic for `I64 -> Externref`.
    const ret = arg0;
    return ret;
}
export function __wbindgen_cast_0000000000000003(arg0, arg1) {
    // Cast intrinsic for `Ref(String) -> Externref`.
    const ret = getStringFromWasm0(arg0, arg1);
    return ret;
}
export function __wbindgen_cast_0000000000000004(arg0) {
    // Cast intrinsic for `U64 -> Externref`.
    const ret = BigInt.asUintN(64, arg0);
    return ret;
}
export function __wbindgen_init_externref_table() {
    const table = wasm.__wbindgen_externrefs;
    const offset = table.grow(4);
    table.set(0, undefined);
    table.set(offset + 0, undefined);
    table.set(offset + 1, null);
    table.set(offset + 2, true);
    table.set(offset + 3, false);
}
const PositionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_position_free(ptr, 1));
const TacticalEngineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_tacticalengine_free(ptr, 1));

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;


let wasm;
export function __wbg_set_wasm(val) {
    wasm = val;
}
