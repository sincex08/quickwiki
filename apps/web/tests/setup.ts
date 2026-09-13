/**
 * Node 环境下的 IndexedDB：db 模块在导入时即创建 Dexie 实例，
 * 必须在一切应用模块导入之前提供全局 indexedDB 实现。
 */
import "fake-indexeddb/auto";
