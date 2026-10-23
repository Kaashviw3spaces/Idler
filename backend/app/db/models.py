import datetime
from sqlalchemy import Column, String, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship
from backend.app.db.database import Base


class TaskDB(Base):
    __tablename__ = "tasks"

    id = Column(String(64), primary_key=True, index=True)
    query = Column(Text, nullable=False)
    workspace_path = Column(String(512), nullable=False)
    status = Column(String(32), nullable=False, default="received", index=True)
    plan_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    actions = relationship("ActionDB", back_populates="task", cascade="all, delete-orphan")


class ActionDB(Base):
    __tablename__ = "actions"

    id = Column(String(64), primary_key=True, index=True)
    task_id = Column(String(64), ForeignKey("tasks.id"), nullable=False, index=True)
    action_type = Column(String(32), nullable=False)
    status = Column(String(32), nullable=False, default="pending", index=True)
    source = Column(String(512), nullable=True)
    destination = Column(String(512), nullable=True)
    message = Column(Text, nullable=True)
    error = Column(Text, nullable=True)
    rollback_supported = Column(Boolean, default=False)
    rollback_metadata_json = Column(Text, nullable=True)
    is_undone = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    task = relationship("TaskDB", back_populates="actions")


class WorkflowDB(Base):
    __tablename__ = "workflows"

    id = Column(String(64), primary_key=True, index=True)
    name = Column(String(128), nullable=False)
    description = Column(Text, nullable=True)
    query = Column(Text, nullable=False)
    workspace_path = Column(String(512), nullable=False)
    is_active = Column(Boolean, default=True)
    schedule_cron = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class WorkflowRunDB(Base):
    __tablename__ = "workflow_runs"

    id = Column(String(64), primary_key=True, index=True)
    workflow_id = Column(String(64), ForeignKey("workflows.id"), nullable=False, index=True)
    task_id = Column(String(64), ForeignKey("tasks.id"), nullable=False)
    status = Column(String(32), nullable=False)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class WorkspaceDB(Base):
    __tablename__ = "workspaces"

    id = Column(String(64), primary_key=True, index=True)
    name = Column(String(128), nullable=False)
    path = Column(String(512), nullable=False, unique=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

