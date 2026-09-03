/** @odoo-module **/

import { FormController } from "@web/views/form/form_controller";
import { patch } from "@web/core/utils/patch";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { _t } from "@web/core/l10n/translation";
import { FetchRecordError } from "@web/model/relational_model/errors";
import { executeButtonCallback } from "@web/views/view_button/view_button_hook";
import { onMounted } from "@odoo/owl";
import { exprToBoolean } from "@web/core/utils/strings";

patch(FormController.prototype, {
    setup() {
        super.setup(...arguments);
        this._classicEditRequested = false;
        this._allowManualSave = false;

        // JURUS AUTO-DISCARD YANG PASTI JALAN:
        onMounted(() => {
            if (
                !this._classicEditRequested &&
                this.canEdit &&
                !this.env.inDialog &&
                !this.hasStandaloneFooter()
            ) {
                // Gunakan setTimeout 0 atau tunggu model siap agar tidak balapan dengan proses internal load record
                setTimeout(async () => {
                    if (
                        this.model.root &&
                        !this.model.root.isNew &&
                        !this._classicEditRequested
                    ) {
                        // Discard perubahan inisialisasi awal dan kunci form ke readonly
                        await this.model.root.discard();
                        if (this.model.root.mode !== "readonly") {
                            await this.model.root.switchMode("readonly");
                        }
                    }
                }, 0);
            }
        });
    },

    get modelParams() {
        const params = super.modelParams;

        if (this.env.inDialog || this.hasStandaloneFooter()) {
            return params;
        }

        // Paksa mode "edit" di awal agar relasi x2many ikut ter-setup sebagai editable form
        if (this.canEdit && params.config.resId) {
            params.config.mode = "edit";
        }
        return params;
    },

    hasStandaloneFooter() {
        if (!this.env.inDialog) {
            return false;
        }
        const footer = this.props.archInfo.xmlDoc.querySelector("footer:not(field footer)");
        if (!footer) {
            return false;
        }
        const replace = footer.getAttribute("replace");
        return !(replace && !exprToBoolean(replace));
    },

    async editRecord() {
        this._classicEditRequested = true;
        await this.model.root.switchMode("edit");
    },

    // KUNCI DISABLE AUTOSAVE:
    // Jangan return false mentah-mentah karena akan membatalkan edit cell x2many!
    async save(params = {}) {
        // 1. Izinkan jika di dialog/wizard atau dipicu klik tombol Save manual
        if (this.env.inDialog || this.hasStandaloneFooter() || this._allowManualSave) {
            return super.save(...arguments);
        }

        // 2. Jika user sedang edit (klik Edit) atau record baru:
        // Saat edit x2many, Odoo memanggil save() untuk sinkronisasi internal baris.
        // Jika bukan klik tombol Save, kita izinkan proses record internal TAPI cegah server write.
        // Cukup return false HANYA jika bukan dari internal field / form blur autosave.
        if (this._classicEditRequested || (this.model.root && this.model.root.isNew)) {
            // Cek apakah ada perubahan dirty. Jika autosave bawaan mau commit ke backend, tahan!
            // Tapi biarkan operasi commit lokal (stayInEdition atau field commit) jalan.
            if (params.stayInEdition || params.isInvalid) {
                return super.save(...arguments);
            }
            
            // Tahan autosave background/blur tanpa me-reset form
            return false;
        }

        // Saat masih readonly (setelah trik discard), tolak autosave apapun
        return false;
    },

    beforeVisibilityChange() {
        if (this.env.inDialog || this.hasStandaloneFooter()) {
            return super.beforeVisibilityChange(...arguments);
        }
        // Matikan autosave saat ganti tab browser
        return;
    },

    saveButtonClicked(params = {}) {
        const isDirtyCheck = async () => {
            const dirty = await this.model.root.isDirty();

            if (!dirty && !this.model.root.isNew) {
                this._classicEditRequested = false;
                return this.model.root.switchMode("readonly");
            }

            // Buka gembok save manual
            this._allowManualSave = true;
            let saved = false;
            try {
                saved = await this.save(params);
            } finally {
                this._allowManualSave = false;
            }

            if (saved !== false) {
                this._classicEditRequested = false;
                await this.model.root.switchMode("readonly");
            }
            return saved;
        };

        return executeButtonCallback(this.ui.activeElement, isDirtyCheck);
    },

    async discard() {
        this._classicEditRequested = false;
        if (this.props && this.props.discardRecord) {
            this.props.discardRecord(this.model.root);
            return;
        }
        await this.model.root.discard();
        if (this.props && this.props.onDiscard) {
            this.props.onDiscard(this.model.root);
        }

        if (this.env.inDialog) {
            await this.env.dialogData.close();
        } else if (this.model.root.isNew) {
            this.env.config.historyBack();
        } else {
            await this.model.root.switchMode("readonly");
        }
    },

    // KUNCI PERINGATAN PINDAH MENU / UNSAVED CHANGES:
    async beforeLeave({ forceLeave } = {}) {
        if (forceLeave) {
            return;
        }

        // Cek dirty langsung dari model
        const dirty = this.model.root && (await this.model.root.isDirty());
        
        // Jika tidak ada perubahan, langsung keluar tanpa tanya
        if (!dirty) {
            if (this._classicEditRequested && this.model.root) {
                this._classicEditRequested = false;
                await this.model.root.switchMode("readonly");
            }
            return;
        }

        // Jika ADA perubahan (dirty = true) dan user mau pindah menu/breadcrumb:
        // Munculkan dialog konfirmasi!
        return new Promise((resolve) => {
            this.dialogService.add(ConfirmationDialog, {
                title: _t("Unsaved changes"),
                body: _t("If you leave now, your changes will be lost. Are you sure you want to continue?"),
                confirmLabel: _t("Discard changes"),
                cancelLabel: _t("Stay on this page"),
                confirm: async () => {
                    this._classicEditRequested = false;
                    await this.model.root.discard();
                    await this.model.root.switchMode("readonly");
                    resolve();
                },
                cancel: () => resolve(false),
            });
        });
    },

    beforeUnload(ev) {
        if (this.model.root && this.model.root.dirty) {
            ev.preventDefault();
            ev.returnValue = "";
        }
    },

    async onPagerUpdate({ offset, resIds }) {
        const dirty = await this.model.root.isDirty();
        try {
            if (dirty) {
                this._allowManualSave = true;
                try {
                    await this.model.root.save({
                        onError: (error, options) => this.onSaveError(error, options, true),
                        nextId: resIds[offset],
                    });
                } finally {
                    this._allowManualSave = false;
                }
            } else {
                await this.model.load({ resId: resIds[offset] });
            }
        } catch (e) {
            if (e instanceof FetchRecordError) {
                this.model.load({
                    resIds: this.model.config.resIds.filter((id) => !e.resIds.includes(id)),
                });
            }
            throw e;
        }

        this._classicEditRequested = false;
        await this.model.root.switchMode("readonly");
    },
});