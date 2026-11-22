/**
 * 合成基准 · 数据入口
 * ====================
 *
 * 六个虚构人物，每人 60 条记忆（title + text，60–160 字）、24 道题
 * （正着问 / 带错字 / 绕着问各 8 道）。合计 360 条记忆、144 道题。
 *
 * 全部是编的，没有一条来自任何真实识海。六套词汇刻意不重叠，
 * 每个人各有 12 条「同人/同物、不同事件」的硬干扰项（编号 25–36），
 * 答案只写在目标那条里，不造假歧义。
 */
import { user as cafe } from './bench-synth/cafe.mjs'
import { user as auto } from './bench-synth/auto.mjs'
import { user as exam } from './bench-synth/exam.mjs'
import { user as dog } from './bench-synth/dog.mjs'
import { user as dev } from './bench-synth/dev.mjs'
import { user as ward } from './bench-synth/ward.mjs'

export const USERS = [cafe, auto, exam, dog, dev, ward]
