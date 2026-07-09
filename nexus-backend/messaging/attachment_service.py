"""
Nexus — Attachment Service
"""

import os
from typing import Set, Dict
from fastapi import HTTPException, UploadFile

# Enforce limits in bytes
IMAGE_AUDIO_LIMIT = 10 * 1024 * 1024      # 10 MB
PDF_DOC_VIDEO_LIMIT = 50 * 1024 * 1024    # 50 MB

# Type categories
_CATEGORIES: Dict[str, Dict[str, Set[str]]] = {
    "image": {
        "exts": {".jpg", ".jpeg", ".png", ".gif", ".webp"},
        "mimes": {"image/jpeg", "image/png", "image/gif", "image/webp"}
    },
    "audio": {
        "exts": {".webm", ".ogg", ".mp3", ".m4a", ".opus", ".wav"},
        "mimes": {
            "audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4",
            "audio/opus", "audio/wav", "video/webm"
        }
    },
    "pdf": {
        "exts": {".pdf"},
        "mimes": {"application/pdf"}
    },
    "video": {
        "exts": {".mp4", ".mov", ".avi", ".mkv", ".webm"},
        "mimes": {
            "video/mp4", "video/quicktime", "video/x-msvideo",
            "video/x-matroska", "video/webm", "video/ogg"
        }
    },
    "document": {
        "exts": {".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".csv", ".rtf", ".zip", ".rar"},
        "mimes": {
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-powerpoint",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "text/plain", "text/csv", "application/rtf", "application/zip",
            "application/x-rar-compressed", "application/x-zip-compressed"
        }
    }
}

class AttachmentService:
    """
    Validates file sizes, extensions, and MIME type consistency.
    """

    def validate_file(self, file: UploadFile, file_size: int) -> str:
        """
        Validate file name, extension, mime-type, and size.
        Returns the category of the file ("image" | "audio" | "pdf" | "video" | "document").
        """
        filename = file.filename or "upload"
        ext = os.path.splitext(filename)[1].lower()
        mime_type = file.content_type

        # Find matching category
        matched_category = None
        for category, rules in _CATEGORIES.items():
            if ext in rules["exts"]:
                matched_category = category
                break

        if not matched_category:
            # Fallback check based on MIME type starts with
            if mime_type:
                if mime_type.startswith("image/"):
                    matched_category = "image"
                elif mime_type.startswith("audio/"):
                    matched_category = "audio"
                elif mime_type.startswith("video/"):
                    matched_category = "video"
                elif mime_type == "application/pdf":
                    matched_category = "pdf"
                else:
                    matched_category = "document"
            else:
                matched_category = "document"

        # Check extension permissions
        all_allowed_exts = set()
        for rules in _CATEGORIES.values():
            all_allowed_exts.update(rules["exts"])

        if ext not in all_allowed_exts and matched_category == "document":
            # If it's a completely unsupported extension, block it
            raise HTTPException(
                status_code=400,
                detail=f"File extension '{ext}' is not supported."
            )

        # Enforce consistency check
        category_rules = _CATEGORIES.get(matched_category)
        if category_rules and mime_type:
            # Verify mime type is consistent
            if mime_type not in category_rules["mimes"]:
                # Ensure starts-with checks for general media categories to be user friendly
                if matched_category == "image" and not mime_type.startswith("image/"):
                    raise HTTPException(status_code=400, detail=f"Inconsistent MIME type '{mime_type}' for image.")
                elif matched_category == "audio" and not (mime_type.startswith("audio/") or mime_type == "video/webm"):
                    raise HTTPException(status_code=400, detail=f"Inconsistent MIME type '{mime_type}' for audio.")
                elif matched_category == "video" and not mime_type.startswith("video/"):
                    raise HTTPException(status_code=400, detail=f"Inconsistent MIME type '{mime_type}' for video.")

        # Size limit validation
        if matched_category in {"image", "audio"}:
            limit = IMAGE_AUDIO_LIMIT
            limit_name = "10MB"
        else:
            limit = PDF_DOC_VIDEO_LIMIT
            limit_name = "50MB"

        if file_size > limit:
            raise HTTPException(
                status_code=400,
                detail=f"File size exceeds the {limit_name} limit for {matched_category} uploads."
            )

        return matched_category


attachment_service = AttachmentService()
