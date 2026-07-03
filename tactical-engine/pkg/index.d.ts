/* tslint:disable */
/* eslint-disable */

export class Position {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    x: number;
    y: number;
}

export class TacticalEngine {
    free(): void;
    [Symbol.dispose](): void;
    ai_decide(team: string): any;
    calculate_awareness(): any;
    check_victory(): any;
    /**
     * Drain all pending game events. Call this after each operation to consume events.
     */
    drain_events(): any;
    execute_attack(ax: number, ay: number, tx: number, ty: number): any;
    get_all_units(): any;
    /**
     * BFS attack range that cannot pass through blocking terrain.
     */
    get_attack_range(x: number, y: number): Position[];
    get_board_info(): any;
    /**
     * Dijkstra-based movable range respecting terrain costs.
     */
    get_movable_range(x: number, y: number): Position[];
    get_phase(): string;
    get_turn(): number;
    get_unit_at(x: number, y: number): any;
    move_unit(fx: number, fy: number, tx: number, ty: number): void;
    constructor(grid_type: string, width: number, height: number);
    next_turn(): void;
    place_unit(id: string, name: string, team: string, x: number, y: number, hp: number, max_hp: number, mp: number, max_mp: number, attack: number, defense: number, speed: number, move_range: number, attack_range: number): void;
    remove_unit(x: number, y: number): void;
    set_terrain(x: number, y: number, terrain_type: string): void;
    start_battle(): void;
}
