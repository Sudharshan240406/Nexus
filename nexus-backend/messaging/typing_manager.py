"""
Nexus — Typing Indicator Manager
"""

import time
from typing import Dict, Set

class TypingManager:
    """
    Tracks typing indicators in-memory.
    Automatically expires typing indicators after a timeout (default 4 seconds).
    """

    def __init__(self, timeout: float = 4.0) -> None:
        self.timeout = timeout
        # Map: (conversation_id_str, user_id_str) -> timestamp (float)
        self._typing_states: Dict[tuple[str, str], float] = {}

    def set_typing(self, user_id: str, conversation_id: str) -> None:
        """Mark a user as currently typing in a conversation."""
        self._typing_states[(str(conversation_id), str(user_id))] = time.time()

    def clear_typing(self, user_id: str, conversation_id: str) -> None:
        """Explicitly clear typing state for a user in a conversation."""
        self._typing_states.pop((str(conversation_id), str(user_id)), None)

    def get_typing_users(self, conversation_id: str) -> list[str]:
        """
        Get list of user IDs currently typing in a conversation.
        Only returns users whose typing timestamp is within the timeout window.
        """
        now = time.time()
        conv_id_str = str(conversation_id)
        typing_users = []

        # Find active and expired keys
        expired_keys = []
        for (cid, uid), ts in self._typing_states.items():
            if cid == conv_id_str:
                if now - ts <= self.timeout:
                    typing_users.append(uid)
                else:
                    expired_keys.append((cid, uid))
            elif now - ts > self.timeout:
                expired_keys.append((cid, uid))

        # Cleanup expired items to prevent leaks
        for k in expired_keys:
            self._typing_states.pop(k, None)

        return typing_users


typing_manager = TypingManager()
