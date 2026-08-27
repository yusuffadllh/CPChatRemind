package com.yusuf.wareminder.data

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface NoteDao {
    @Query("SELECT * FROM notes ORDER BY createdAt DESC")
    fun observeAll(): Flow<List<NoteEntity>>

    @Insert
    suspend fun insert(note: NoteEntity): Long

    @Delete
    suspend fun delete(note: NoteEntity)
}

@Dao
interface PendingDao {
    @Query("SELECT * FROM pending WHERE status = :status ORDER BY createdAt DESC")
    fun observeByStatus(status: PendingStatus): Flow<List<PendingEntity>>

    @Query("SELECT * FROM pending WHERE id = :id")
    suspend fun findById(id: Long): PendingEntity?

    @Insert
    suspend fun insert(item: PendingEntity): Long

    @Update
    suspend fun update(item: PendingEntity)

    @Query("UPDATE pending SET status = :status, error = :error WHERE id = :id")
    suspend fun updateStatus(id: Long, status: PendingStatus, error: String?)
}
