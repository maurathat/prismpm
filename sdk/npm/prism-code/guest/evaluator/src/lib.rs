//! The evaluator guest: one fixed Core-Wasm module (`hologram:guest/core-wasm@1`) that runs an app's model.
//!
//! Nothing is compiled for an app. The app's program, written by `src/journey/model-guest.mjs` from the model's
//! semantic snapshot, is attached to this module as one data segment at `__heap_base`. A request runs the
//! program's entry on the request bytes and answers with the bytes it returns.
//!
//! It mirrors the reference evaluator (`src/journey/model-eval.mjs`) term for term, and a build compares the two
//! on the app's vectors. That it follows the model is tested, not proved.
//!
//! Anything this module cannot do exactly is a trap, never an answer: a number outside 127 bits, or memory that
//! cannot grow. A trap reaches the host as a failed request.
#![no_std]

extern crate alloc;

use alloc::rc::Rc;
use alloc::vec::Vec;
use core::alloc::{GlobalAlloc, Layout};
use core::cell::RefCell;

extern "C" {
    static __heap_base: u8;
}

fn trap() -> ! {
    core::arch::wasm32::unreachable()
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    trap()
}

/// Where the program is: the first byte after this module's own data.
fn base() -> usize {
    // The linker defines `__heap_base`; only its address is taken.
    core::ptr::addr_of!(__heap_base) as usize
}

/// One 32-bit word of the program.
fn word(index: usize) -> u32 {
    // SAFETY: the app's linker placed the program at `base()` and grew the memory to hold it; every index read
    // comes from the program's own tables, which the linker wrote.
    unsafe { core::ptr::read_unaligned((base() + 4 * index) as *const u32) }
}

const MAGIC: u32 = 0x3156_4550; // "PEV1"
const H_ENTRY: usize = 2;
const H_FUNCS: usize = 3;
const H_NODES: usize = 4;
const H_POOL: usize = 6;
const H_TOTAL: usize = 7;

/// An allocator that never frees: a host runs every request on a fresh instance.
struct Bump;
static mut NEXT: usize = 0;

fn bump(size: usize, align: usize) -> *mut u8 {
    // SAFETY: a guest is single-threaded, so `NEXT` has one reader and writer.
    unsafe {
        let mut next = core::ptr::read(core::ptr::addr_of!(NEXT));
        if next == 0 {
            next = base() + if word(0) == MAGIC { word(H_TOTAL) as usize } else { 0 };
        }
        let at = (next + align - 1) & !(align - 1);
        let end = match at.checked_add(size) {
            Some(end) => end,
            None => trap(),
        };
        let have = core::arch::wasm32::memory_size(0) * 65536;
        if end > have {
            let pages = (end - have + 65535) / 65536;
            if core::arch::wasm32::memory_grow(0, pages) == usize::MAX {
                trap();
            }
        }
        core::ptr::write(core::ptr::addr_of_mut!(NEXT), end);
        at as *mut u8
    }
}

// SAFETY: `bump` returns distinct, aligned blocks inside the module's memory, and nothing is freed.
unsafe impl GlobalAlloc for Bump {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        bump(layout.size(), layout.align())
    }
    unsafe fn dealloc(&self, _: *mut u8, _: Layout) {}
}

#[global_allocator]
static ALLOCATOR: Bump = Bump;

// ---- Values.

#[derive(Clone)]
enum V {
    Num(i128),
    Bool(bool),
    Unit,
    Bytes(Rc<Vec<u8>>),
    Str(Rc<Vec<u8>>),
    Ctor(u32, Rc<Vec<V>>),
    Rec(Rc<Vec<(u32, V)>>),
}

const NONE: u32 = 0;
const SOME: u32 = 1;
const NIL: u32 = 2;
const CONS: u32 = 3;
const ZERO: u32 = 4;
const SUCC: u32 = 5;
const FALSE: u32 = 6;
const TRUE: u32 = 7;
const LT: u32 = 8;
const EQ: u32 = 9;
const GT: u32 = 10;
const PAIR: u32 = 11;

fn ctor(tag: u32, args: Vec<V>) -> V {
    V::Ctor(tag, Rc::new(args))
}

fn equal(a: &V, b: &V) -> bool {
    match (a, b) {
        (V::Num(x), V::Num(y)) => x == y,
        (V::Bool(x), V::Bool(y)) => x == y,
        (V::Unit, V::Unit) => true,
        (V::Bytes(x), V::Bytes(y)) | (V::Str(x), V::Str(y)) => x == y,
        (V::Ctor(s, x), V::Ctor(t, y)) => s == t && x.len() == y.len() && x.iter().zip(y.iter()).all(|(p, q)| equal(p, q)),
        (V::Rec(x), V::Rec(y)) => x.len() == y.len() && x.iter().zip(y.iter()).all(|(p, q)| p.0 == q.0 && equal(&p.1, &q.1)),
        _ => false,
    }
}

fn num(v: &V) -> i128 {
    match v {
        V::Num(n) => *n,
        _ => trap(),
    }
}

fn truth(v: &V) -> bool {
    match v {
        V::Bool(b) => *b,
        _ => trap(),
    }
}

fn bytes(v: &V) -> &Rc<Vec<u8>> {
    match v {
        V::Bytes(b) => b,
        _ => trap(),
    }
}

fn exact(n: Option<i128>) -> i128 {
    match n {
        Some(n) => n,
        None => trap(),
    }
}

fn size(n: i128) -> usize {
    if n < 0 || n > u32::MAX as i128 {
        trap()
    }
    n as usize
}

// ---- The program's nodes: four words each, the kind and three operands.

const VAR: u32 = 0;
const NUM: u32 = 1;
const BYTES: u32 = 2;
const STR: u32 = 3;
const BOOL: u32 = 4;
const UNIT: u32 = 5;
const CTOR: u32 = 6;
const RECORD: u32 = 7;
const PROJECT: u32 = 8;
const CALL: u32 = 9;
const IF: u32 = 10;
const LET: u32 = 11;
const MATCH: u32 = 12;
const AND: u32 = 13;
const OR: u32 = 14;
const NOT: u32 = 15;
const ADD: u32 = 16;
const BEQ: u32 = 17;
const BLE: u32 = 18;
const BLT: u32 = 19;
const PRIM: u32 = 20;
const FIRST: u32 = 21;
const SECOND: u32 = 22;

struct Node {
    kind: u32,
    x: u32,
    y: u32,
    z: u32,
}

fn node(index: u32) -> Node {
    let at = word(H_NODES) as usize + 4 * index as usize;
    Node { kind: word(at), x: word(at + 1), y: word(at + 2), z: word(at + 3) }
}

fn pool(offset: u32, length: u32) -> Vec<u8> {
    let start = base() + word(H_POOL) as usize + offset as usize;
    // SAFETY: the linker wrote `length` bytes of the pool at this offset.
    unsafe { core::slice::from_raw_parts(start as *const u8, length as usize) }.to_vec()
}

type Env = Rc<RefCell<Vec<V>>>;

fn scope(slots: u32) -> Env {
    Rc::new(RefCell::new(alloc::vec![V::Unit; slots as usize]))
}

/// The parts a strict node evaluates, left to right, before it is finished: `(first word, count, stride)`.
fn parts(n: &Node, index: u32) -> (u32, u32, u32, bool) {
    // (where, count, stride, in the node itself)
    match n.kind {
        CTOR | CALL | PRIM => (n.y, n.z, 1, false),
        RECORD => (n.x + 1, n.y, 2, false),
        PROJECT => (index, 1, 0, true),
        NOT | FIRST | SECOND => (index, 1, 0, true),
        ADD | BEQ | BLE | BLT => (index, 2, 0, true),
        _ => trap(),
    }
}

fn part(n: &Node, index: u32, at: u32) -> u32 {
    let (start, _, stride, own) = parts(n, index);
    if own {
        match (n.kind, at) {
            (PROJECT, _) => n.y,
            (_, 0) => n.x,
            _ => n.y,
        }
    } else {
        word((start + at * stride) as usize)
    }
}

// ---- Result types, as the program names them: 0 Nat, 1 Int, then the fixed widths.

/// The bits of a fixed-width type and whether it is signed; `None` for Nat and Int.
fn fixed(kind: u32) -> Option<(u32, bool)> {
    match kind {
        2 => Some((8, false)),
        3 => Some((16, false)),
        4 => Some((32, false)),
        5 => Some((64, false)),
        6 => Some((8, true)),
        7 => Some((16, true)),
        8 => Some((32, true)),
        9 => Some((64, true)),
        _ => None,
    }
}

/// `Fixed.fromInt`: the value modulo the width, in the type's range.
fn wrap(kind: u32, value: i128) -> i128 {
    let (bits, signed) = match fixed(kind) {
        Some(shape) => shape,
        None => trap(),
    };
    let modulus = 1i128 << bits;
    let low = value.rem_euclid(modulus);
    if signed && low >= modulus / 2 { low - modulus } else { low }
}

/// `checkedFromInt`: the value when the type holds it.
fn checked(kind: u32, value: Option<i128>) -> V {
    let (bits, signed) = match fixed(kind) {
        Some(shape) => shape,
        None => trap(),
    };
    let (least, greatest) = if signed { (-(1i128 << (bits - 1)), (1i128 << (bits - 1)) - 1) } else { (0, (1i128 << bits) - 1) };
    match value {
        Some(n) if n >= least && n <= greatest => ctor(SOME, alloc::vec![V::Num(n)]),
        _ => ctor(NONE, Vec::new()),
    }
}

/// Arithmetic at a result type: Nat and Int are exact, a fixed width wraps.
fn at(kind: u32, value: i128) -> V {
    V::Num(if fixed(kind).is_some() { wrap(kind, value) } else { value })
}

fn items(v: &V) -> Vec<V> {
    let mut out = Vec::new();
    let mut cell = v.clone();
    loop {
        let next = match &cell {
            V::Ctor(CONS, parts) => {
                out.push(parts[0].clone());
                parts[1].clone()
            }
            V::Ctor(NIL, _) => return out,
            _ => trap(),
        };
        cell = next;
    }
}

fn list(values: &[V]) -> V {
    let mut out = ctor(NIL, Vec::new());
    for value in values.iter().rev() {
        out = ctor(CONS, alloc::vec![value.clone(), out]);
    }
    out
}

fn option(value: Option<V>) -> V {
    match value {
        Some(v) => ctor(SOME, alloc::vec![v]),
        None => ctor(NONE, Vec::new()),
    }
}

fn primitive(op: u32, kind: u32, v: &[V]) -> V {
    match op {
        // subtract: Nat stops at zero, Int does not, a fixed width wraps.
        0 => {
            let d = exact(num(&v[0]).checked_sub(num(&v[1])));
            if kind == 0 { V::Num(if d < 0 { 0 } else { d }) } else { at(kind, d) }
        }
        // A fixed width wraps, so a product past 127 bits is still exact once reduced; Nat and Int must fit.
        1 => {
            if fixed(kind).is_some() {
                V::Num(wrap(kind, num(&v[0]).wrapping_mul(num(&v[1]))))
            } else {
                V::Num(exact(num(&v[0]).checked_mul(num(&v[1]))))
            }
        }
        // quotient and remainder: a zero divisor answers the stated zero case; both round toward zero.
        2 => V::Num(if num(&v[1]) == 0 { num(&v[2]) } else { exact(num(&v[0]).checked_div(num(&v[1]))) }),
        3 => V::Num(if num(&v[1]) == 0 { num(&v[2]) } else { exact(num(&v[0]).checked_rem(num(&v[1]))) }),
        4 | 5 => V::Num(num(&v[0])),
        6 => V::Bool(equal(&v[0], &v[1])),
        7 => match &v[0] {
            V::Bytes(left) => {
                let mut out = (**left).clone();
                out.extend_from_slice(bytes(&v[1]));
                V::Bytes(Rc::new(out))
            }
            _ => {
                let mut out = items(&v[0]);
                out.extend(items(&v[1]));
                list(&out)
            }
        },
        8 => V::Num(match &v[0] {
            V::Bytes(b) => b.len() as i128,
            // String.length counts characters: every byte that does not continue one.
            V::Str(text) => text.iter().filter(|byte| (**byte & 0xc0) != 0x80).count() as i128,
            _ => items(&v[0]).len() as i128,
        }),
        9 => {
            let i = num(&v[1]);
            match &v[0] {
                V::Bytes(b) => option(if i >= 0 && i < b.len() as i128 { Some(V::Num(b[i as usize] as i128)) } else { None }),
                _ => {
                    let all = items(&v[0]);
                    option(if i >= 0 && i < all.len() as i128 { Some(all[i as usize].clone()) } else { None })
                }
            }
        }
        10 => {
            let (start, count) = (num(&v[1]), num(&v[2]));
            let end = exact(start.checked_add(count));
            match &v[0] {
                V::Bytes(b) => option(if start >= 0 && count >= 0 && end <= b.len() as i128 { Some(V::Bytes(Rc::new(b[size(start)..size(end)].to_vec()))) } else { None }),
                _ => {
                    let all = items(&v[0]);
                    option(if start >= 0 && count >= 0 && end <= all.len() as i128 { Some(list(&all[size(start)..size(end)])) } else { None })
                }
            }
        }
        11 => ctor(
            match bytes(&v[0]).as_slice().cmp(bytes(&v[1]).as_slice()) {
                core::cmp::Ordering::Less => LT,
                core::cmp::Ordering::Equal => EQ,
                core::cmp::Ordering::Greater => GT,
            },
            Vec::new(),
        ),
        12 => at(kind, exact(num(&v[0]).checked_neg())),
        // Checked arithmetic: none outside the type.
        13 => checked(kind, num(&v[0]).checked_add(num(&v[1]))),
        14 => checked(kind, num(&v[0]).checked_sub(num(&v[1]))),
        15 => checked(kind, num(&v[0]).checked_mul(num(&v[1]))),
        16 => checked(kind, num(&v[0]).checked_neg()),
        17 => checked(kind, if num(&v[1]) == 0 { None } else { num(&v[0]).checked_div(num(&v[1])) }),
        18 => checked(kind, Some(num(&v[0]))),
        19 => V::Num(wrap(kind, num(&v[0]) & num(&v[1]))),
        20 => V::Num(wrap(kind, num(&v[0]) | num(&v[1]))),
        21 => V::Num(wrap(kind, num(&v[0]) ^ num(&v[1]))),
        22 => V::Num(wrap(kind, !num(&v[0]))),
        // A shift of the width or more is refused.
        23 | 24 => {
            let (bits, _) = match fixed(kind) {
                Some(shape) => shape,
                None => trap(),
            };
            let amount = num(&v[1]);
            option(if amount >= 0 && amount < bits as i128 {
                Some(V::Num(wrap(kind, if op == 23 { num(&v[0]) << amount as u32 } else { num(&v[0]) >> amount as u32 })))
            } else {
                None
            })
        }
        25 => match &v[0] {
            V::Str(text) => V::Bytes(text.clone()),
            _ => trap(),
        },
        26 => {
            let b = bytes(&v[0]);
            option(if core::str::from_utf8(b).is_ok() { Some(V::Str(b.clone())) } else { None })
        }
        _ => trap(),
    }
}

fn finish(n: &Node, v: Vec<V>) -> V {
    match n.kind {
        CTOR => ctor(n.x, v),
        RECORD => V::Rec(Rc::new(v.into_iter().enumerate().map(|(i, value)| (word((n.x + 2 * i as u32) as usize), value)).collect())),
        PROJECT => match &v[0] {
            V::Rec(fields) => match fields.iter().find(|f| f.0 == n.x) {
                Some(f) => f.1.clone(),
                None => trap(),
            },
            _ => trap(),
        },
        FIRST | SECOND => match &v[0] {
            V::Ctor(PAIR, items) => items[(n.kind - FIRST) as usize].clone(),
            _ => trap(),
        },
        NOT => V::Bool(!truth(&v[0])),
        ADD => V::Num(exact(num(&v[0]).checked_add(num(&v[1])))),
        BEQ => V::Bool(equal(&v[0], &v[1])),
        BLE => V::Bool(num(&v[0]) <= num(&v[1])),
        BLT => V::Bool(num(&v[0]) < num(&v[1])),
        PRIM => primitive(n.x & 0xffff, n.x >> 16, &v),
        _ => trap(),
    }
}

/// The branch of a match that takes `value`: its body, with its binders set in `env`.
fn branch(n: &Node, value: &V, env: &Env) -> u32 {
    for i in 0..n.z {
        let at = (n.y + 4 * i) as usize;
        let (tag, body, binders, slots) = (word(at), word(at + 1), word(at + 2), word(at + 3));
        let taken: Option<Vec<V>> = match value {
            V::Num(k) if tag == ZERO && *k == 0 => Some(Vec::new()),
            V::Num(k) if tag == SUCC && *k > 0 => Some(alloc::vec![V::Num(*k - 1)]),
            V::Bool(b) if tag == (if *b { TRUE } else { FALSE }) => Some(Vec::new()),
            V::Ctor(t, items) if *t == tag => Some((**items).clone()),
            _ => None,
        };
        if let Some(values) = taken {
            if values.len() < binders as usize {
                trap();
            }
            let mut scope = env.borrow_mut();
            for b in 0..binders as usize {
                scope[word(slots as usize + b) as usize] = values[b].clone();
            }
            return body;
        }
    }
    trap()
}

enum Frame {
    /// A strict node part-way through its parts.
    Parts { index: u32, env: Env, values: Vec<V> },
    /// A node that decides what runs after its first part.
    After { index: u32, env: Env },
}

/// The machine: a loop over an explicit stack, as the reference evaluator's is, so a model's recursion depth is
/// bounded by memory and not by the host's call stack.
fn run(start: u32, start_env: Env) -> V {
    let mut stack: Vec<Frame> = Vec::new();
    let mut index = start;
    let mut env = start_env;
    let mut value = V::Unit;
    let mut down = true;
    loop {
        if down {
            down = false;
            let n = node(index);
            match n.kind {
                VAR => value = env.borrow()[n.x as usize].clone(),
                NUM => {
                    let b = pool(n.x, 16);
                    let mut raw = [0u8; 16];
                    raw.copy_from_slice(&b);
                    value = V::Num(i128::from_le_bytes(raw));
                }
                BYTES => value = V::Bytes(Rc::new(pool(n.x, n.y))),
                STR => value = V::Str(Rc::new(pool(n.x, n.y))),
                BOOL => value = V::Bool(n.x != 0),
                UNIT => value = V::Unit,
                IF | LET | MATCH | AND | OR => {
                    stack.push(Frame::After { index, env: env.clone() });
                    index = match n.kind {
                        LET => n.y,
                        _ => n.x,
                    };
                    down = true;
                }
                _ => {
                    let (_, count, _, _) = parts(&n, index);
                    if count > 0 {
                        stack.push(Frame::Parts { index, env: env.clone(), values: Vec::new() });
                        index = part(&n, index, 0);
                        down = true;
                    } else if n.kind == CALL {
                        let f = word(H_FUNCS) as usize + 3 * n.x as usize;
                        env = scope(word(f + 1));
                        index = word(f + 2);
                        down = true;
                    } else {
                        value = finish(&n, Vec::new());
                    }
                }
            }
            if down {
                continue;
            }
        }
        let frame = match stack.pop() {
            Some(frame) => frame,
            None => return value,
        };
        match frame {
            Frame::Parts { index: at, env: scope_of, mut values } => {
                let n = node(at);
                values.push(value);
                let (_, count, _, _) = parts(&n, at);
                if (values.len() as u32) < count {
                    index = part(&n, at, values.len() as u32);
                    env = scope_of.clone();
                    stack.push(Frame::Parts { index: at, env: scope_of, values });
                    value = V::Unit;
                    down = true;
                } else if n.kind == CALL {
                    // A call runs the definition's body in its own scope; nothing of the caller's stays on the stack.
                    let f = word(H_FUNCS) as usize + 3 * n.x as usize;
                    let callee = scope(word(f + 1));
                    {
                        let mut slots = callee.borrow_mut();
                        for (i, v) in values.into_iter().enumerate() {
                            slots[i] = v;
                        }
                    }
                    env = callee;
                    index = word(f + 2);
                    value = V::Unit;
                    down = true;
                } else {
                    value = finish(&n, values);
                }
            }
            Frame::After { index: at, env: scope_of } => {
                let n = node(at);
                env = scope_of;
                down = true;
                match n.kind {
                    AND => {
                        if truth(&value) {
                            index = n.y;
                        } else {
                            down = false;
                        }
                    }
                    OR => {
                        if truth(&value) {
                            down = false;
                        } else {
                            index = n.y;
                        }
                    }
                    IF => index = if truth(&value) { n.y } else { n.z },
                    LET => {
                        env.borrow_mut()[n.x as usize] = value.clone();
                        index = n.z;
                    }
                    _ => index = branch(&n, &value, &env),
                }
            }
        }
    }
}

/// Reserve `length` bytes for a request and return their offset.
#[no_mangle]
pub extern "C" fn holo_alloc(length: u32) -> u32 {
    bump(length as usize, 1) as u32
}

/// Run the request at `offset`. Returns `offset << 32 | length` of the response.
#[no_mangle]
pub extern "C" fn holo_run(offset: u32, length: u32) -> u64 {
    if word(0) != MAGIC {
        trap();
    }
    // SAFETY: the host wrote `length` bytes at the offset `holo_alloc` gave it.
    let request = unsafe { core::slice::from_raw_parts(offset as usize as *const u8, length as usize) }.to_vec();
    let f = word(H_FUNCS) as usize + 3 * word(H_ENTRY) as usize;
    let env = scope(word(f + 1));
    env.borrow_mut()[0] = V::Bytes(Rc::new(request));
    match run(word(f + 2), env) {
        V::Bytes(out) => {
            let at = out.as_ptr() as u32;
            let len = out.len() as u32;
            core::mem::forget(out);
            ((at as u64) << 32) | len as u64
        }
        _ => trap(),
    }
}
