/** @odoo-module **/

import { FormController } from "@web/views/form/form_controller";
import { patch } from "@web/core/utils/patch";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { _t } from "@web/core/l10n/translation";
import { FetchRecordError } from "@web/model/relational_model/errors";

patch(FormController.prototype, {
    get modelParams() {
        const params = super.modelParams;
        // Force readonly for existing records unless mode is explicitly set via props
        if (!this.props.mode && this.canEdit && params.config.resId) {
            params.config.mode = "readonly";
        }
        return params;
    },

    editRecord() {
        this.model.root.switchMode("edit");
    },

    async saveButtonClicked(params = {}) {
        // Jika tidak ada perubahan data pada record yang sudah ada, langsung ubah ke readonly
        if (!this.model.root.dirty && !this.model.root.isNew) {
            return this.model.root.switchMode("readonly");
        }

        // Eksekusi penyimpanan data ke server secara direct
        const saved = await this.save(params);
        
        // Jika berhasil disimpan, kunci kembali tampilan form menjadi readonly
        if (saved !== false) {
            await this.model.root.switchMode("readonly");
        }
        
        return saved;
    },

    async discard() {
        if (this.props.discardRecord) {
            this.props.discardRecord(this.model.root);
            return;
        }
        await this.model.root.discard();
        if (this.props.onDiscard) {
            this.props.onDiscard(this.model.root);
        }
        if (this.model.root.isNew || this.env.inDialog) {
            this.env.config.historyBack();
        } else {
            // Switch back to readonly instead of navigating back
            await this.model.root.switchMode("readonly");
        }
    },

    async beforeLeave() {
        // Only auto-save if currently in edit mode
        if (this.model.root.isInEdition && this.model.root.dirty) {
            return this.save({
                reload: false,
                onError: this.onSaveError.bind(this),
            });
        }
    },

    async beforeVisibilityChange() {
        // Only auto-save if currently in edit mode
        if (
            document.visibilityState === "hidden" &&
            this.formInDialog === 0 &&
            this.model.root.isInEdition
        ) {
            return this.model.root.save();
        }
    },

    async onPagerUpdate({ offset, resIds }) {
        const isEditing = this.model.root.isInEdition;
        if (isEditing) {
            const dirty = await this.model.root.isDirty();
            try {
                if (dirty) {
                    await this.model.root.save({
                        onError: this.onSaveError.bind(this),
                        nextId: resIds[offset],
                    });
                } else {
                    await this.model.root.discard();
                    await this.model.load({ resId: resIds[offset] });
                }
            } catch (e) {
                if (e instanceof FetchRecordError) {
                    this.model.load({
                        resIds: this.model.config.resIds.filter(
                            (id) => !e.resIds.includes(id)
                        ),
                    });
                }
                throw e;
            }
        } else {
            try {
                await this.model.load({ resId: resIds[offset] });
            } catch (e) {
                if (e instanceof FetchRecordError) {
                    this.model.load({
                        resIds: this.model.config.resIds.filter(
                            (id) => !e.resIds.includes(id)
                        ),
                    });
                }
                throw e;
            }
        }
        // Ensure new record opens in readonly
        if (this.model.root.resId && this.canEdit && !this.props.mode) {
            await this.model.root.switchMode("readonly");
        }
    },
});
