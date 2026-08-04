/** @odoo-module **/

import { FormController } from "@web/views/form/form_controller";
import { patch } from "@web/core/utils/patch";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { _t } from "@web/core/l10n/translation";
import { FetchRecordError } from "@web/model/relational_model/errors";
import { executeButtonCallback } from "@web/views/view_button/view_button_hook";

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

        // Bungkus dengan executeButtonCallback (perilaku asli Odoo) agar tombol-tombol
        // ter-disable selama proses simpan, mencegah double-submit akibat klik ganda.
        return executeButtonCallback(this.ui.activeElement, async () => {
            const saved = await this.save(params);

            // Jika berhasil disimpan, kunci kembali tampilan form menjadi readonly
            if (saved !== false) {
                await this.model.root.switchMode("readonly");
            }

            return saved;
        });
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

    async beforeLeave(options = {}) {
        // Nothing to protect if we're not editing, or the framework explicitly asks to
        // leave without checks (e.g. "Discard" was already chosen on the error dialog).
        if (!this.model.root.isInEdition || options.forceLeave) {
            return;
        }
        const dirty = await this.model.root.isDirty();
        if (!dirty) {
            return;
        }
        // Classic Odoo confirmation: ask before discarding unsaved changes and leaving,
        // instead of silently auto-saving (modern default) or silently leaving.
        return new Promise((resolve) => {
            this.dialogService.add(ConfirmationDialog, {
                title: _t("Unsaved changes"),
                body: _t(
                    "If you leave now, your changes will be lost. Are you sure you want to continue?"
                ),
                confirmLabel: _t("Discard changes"),
                cancelLabel: _t("Stay on this page"),
                confirm: async () => {
                    await this.model.root.discard();
                    resolve();
                },
                // Any way of closing the dialog without confirming (Cancel, Escape, X)
                // must block the navigation and keep the user on the current page.
                cancel: () => resolve(false),
            });
        });
    },

    // Disable the modern "silent auto-save" on browser refresh/close (core calls
    // urgentSave() here): this module's whole point is manual Save/Discard, so unsaved
    // changes must never be persisted behind the user's back on unload. Instead, trigger
    // the browser's native "leave site?" prompt, matching classic pre-autosave Odoo.
    beforeUnload(ev) {
        if (this.model.root.isInEdition && this.model.root.dirty) {
            ev.preventDefault();
            ev.returnValue = "";
        }
    },

    // Same reasoning as beforeUnload: don't auto-save when the tab is hidden/switched.
    beforeVisibilityChange() {},

    async onPagerUpdate({ offset, resIds }) {
        const isEditing = this.model.root.isInEdition;
        if (isEditing) {
            const dirty = await this.model.root.isDirty();
            try {
                if (dirty) {
                    await this.model.root.save({
                        onError: (error, options) => this.onSaveError(error, options, true),
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
