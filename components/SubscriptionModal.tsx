// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

'use client';
import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { billingApi } from '@/lib/realApi';
import { TariffPlan, BillingPeriod, SubscriptionStatus } from '@/lib/types';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { useNavbarStore } from '@/store/useNavbarStore';

interface SubscriptionModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function SubscriptionModal({ isOpen, onClose }: SubscriptionModalProps) {
    const t = useTranslations('SubscriptionModal');

    const { currentWorkspace } = useWorkspaceStore();
    const user = useNavbarStore((state) => state.user);

    const [tariffs, setTariffs] = useState<TariffPlan[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isCheckingOut, setIsCheckingOut] = useState<number | null>(null);
    const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');
    const [localSub, setLocalSub] = useState(useWorkspaceStore.getState().currentSubscription);

    useEffect(() => {
        if (isOpen) {
            fetchTariffs();
            if (currentWorkspace) {
                refreshSubscription();
            }
        }
    }, [isOpen, currentWorkspace]);

    const refreshSubscription = async () => {
        if (!currentWorkspace) return;
        try {
            const sub = await billingApi.getWorkspaceSubscription(currentWorkspace.id);
            useWorkspaceStore.setState({ currentSubscription: sub });
            setLocalSub(sub);
        } catch (e) {
            useWorkspaceStore.setState({ currentSubscription: null });
            setLocalSub(null);
        }
    };

    const fetchTariffs = async () => {
        setIsLoading(true);
        try {
            const data = await billingApi.getTariffs();
            setTariffs(data.filter(t => t.is_active && t.is_public).sort((a, b) => a.sort_order - b.sort_order));
        } catch (error) {
            console.error('Failed to fetch tariffs', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCheckout = async (tariffId: number) => {
        if (!user) {
            const currentPath = window.location.pathname + window.location.search;
            window.location.href = `/?redirect=${encodeURIComponent(currentPath)}`;
            return;
        }

        if (!currentWorkspace) {
            alert(t('loginRequiredAlert'));
            return;
        }

        setIsCheckingOut(tariffId);
        try {
            const res = await billingApi.createCheckoutSession({
                workspace_id: currentWorkspace.id,
                tariff_plan_id: tariffId,
                billing_period: billingPeriod as BillingPeriod,
                return_url: window.location.href,
            });
            window.location.href = res.payment_url;
        } catch (error: any) {
            alert(error.message || t('paymentError'));
            setIsCheckingOut(null);
        }
    };

    const getStatusBadge = () => {
        if (!localSub) {
            return (
                <span className="px-2 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-500 rounded-full">
                    {t('noSubscription')}
                </span>
            );
        }

        const statusMap: Record<string, { labelKey: string; color: string }> = {
            [SubscriptionStatus.TRIAL]: { labelKey: 'status.trial', color: 'bg-blue-100 text-blue-700' },
            [SubscriptionStatus.ACTIVE]: { labelKey: 'status.active', color: 'bg-green-100 text-green-700' },
            [SubscriptionStatus.PAST_DUE]: { labelKey: 'status.pastDue', color: 'bg-orange-100 text-orange-700' },
            [SubscriptionStatus.CANCELED]: { labelKey: 'status.canceled', color: 'bg-slate-100 text-slate-600' },
            [SubscriptionStatus.EXPIRED]: { labelKey: 'status.expired', color: 'bg-red-100 text-red-700' },
        };

        const entry = statusMap[localSub.status] || { labelKey: null, color: 'bg-slate-100 text-slate-600' };
        const label = entry.labelKey ? t(entry.labelKey as any) : localSub.status;

        return (
            <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${entry.color}`}>
                {label}
            </span>
        );
    };

    const currentTariffName = localSub?.tariff_plan?.name || tariffs.find(t => t.id === localSub?.tariff_plan_id)?.name;

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[400] flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
                    <div>
                        <h2 className="text-base font-bold text-slate-800">{t('title')}</h2>
                        <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                            <span>{t('currentStatus')}</span>
                            {getStatusBadge()}
                            {currentTariffName && (
                                <span className="text-slate-700 font-semibold">«{currentTariffName}»</span>
                            )}
                            {localSub?.expires_at && (
                                <span className="text-slate-400">
                                    {t('details.expiresAt', {
                                        date: new Date(localSub.expires_at).toLocaleDateString(process.env.NEXT_FORMAT_LOCALE)
                                    })}
                                </span>
                            )}
                        </p>
                        {!user && (
                            <p className="text-xs text-orange-600 mt-1.5 flex items-center gap-1.5 font-medium">
                                <i className="fa-solid fa-circle-info"></i>
                                {t('loginRequiredHint')}
                            </p>
                        )}
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors">
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                </div>

                {/* Billing Period Toggle */}
                <div className="flex justify-center py-4 border-b border-slate-100">
                    <div className="inline-flex p-1 bg-slate-100 rounded-lg">
                        <button
                            onClick={() => setBillingPeriod('monthly')}
                            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors ${billingPeriod === 'monthly' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
                        >
                            {t('billingPeriod.monthly')}
                        </button>
                        <button
                            onClick={() => setBillingPeriod('yearly')}
                            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors ${billingPeriod === 'yearly' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
                        >
                            {t('billingPeriod.yearly')} <span className="text-green-600 text-[10px] ml-1">{t('billingPeriod.yearlyDiscount')}</span>
                        </button>
                    </div>
                </div>

                {/* Tariffs Grid */}
                <div className="flex-1 overflow-y-auto p-6">
                    {isLoading ? (
                        <div className="flex justify-center items-center h-40 text-slate-400">
                            <i className="fa-solid fa-spinner fa-spin mr-2"></i> {t('loading')}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {tariffs.map((tariff) => {
                                const isTrial = localSub?.status === SubscriptionStatus.TRIAL;
                                const isActiveCurrent = localSub?.tariff_plan_id === tariff.id && localSub.status === SubscriptionStatus.ACTIVE;
                                const isPrevious = !isTrial && localSub?.tariff_plan_id === tariff.id && !isActiveCurrent && localSub.status !== null;
                                const isTrialTariff = isTrial && localSub?.tariff_plan_id === tariff.id;
                                const displayPeriod = isActiveCurrent && localSub ? localSub.billing_period : billingPeriod;
                                const price = displayPeriod === 'monthly' ? tariff.price_monthly : tariff.price_yearly;
                                const periodSuffix = t(`periodSuffix.${displayPeriod}` as any);
                                const isHighlighted = isActiveCurrent || isPrevious || isTrialTariff;

                                return (
                                    <div key={tariff.id} className={`relative border rounded-xl p-5 flex flex-col transition-all ${isHighlighted ? 'border-primary-500 ring-2 ring-primary-100' : 'border-slate-200 hover:border-primary-300'}`}>
                                        {isActiveCurrent && (
                                            <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-primary-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                                                {t('badge.current')}
                                            </div>
                                        )}
                                        {isPrevious && (
                                            <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-slate-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                                                {t('badge.yourTariff')}
                                            </div>
                                        )}
                                        {isTrialTariff && (
                                            <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                                                {t('badge.trial')}
                                            </div>
                                        )}

                                        <h3 className="text-sm font-bold text-slate-800">{tariff.name}</h3>
                                        <p className="text-xs text-slate-500 mt-1 mb-4 min-h-[32px]">{tariff.description}</p>

                                        <div className="mb-4">
                                            <span className="text-2xl font-bold text-slate-800">{price.toLocaleString(process.env.NEXT_FORMAT_LOCALE)} ₽</span>
                                            <span className="text-xs text-slate-500"> / {periodSuffix}</span>
                                        </div>

                                        <ul className="space-y-2 mb-4 flex-1">
                                            {tariff.features_json && tariff.features_json.length > 0 ? (
                                                tariff.features_json.map((feat, idx) => (
                                                    <li key={idx} className="flex items-start gap-2 text-xs text-slate-600">
                                                        <i className="fa-solid fa-check text-green-500 mt-0.5"></i>
                                                        <span>{feat}</span>
                                                    </li>
                                                ))
                                            ) : (
                                                <li className="text-xs text-slate-400 italic">{t('basicFeatures')}</li>
                                            )}
                                        </ul>

                                        {/* Детали подписки (для активного и истекшего) */}
                                        {(isActiveCurrent || isPrevious) && localSub && (
                                            <div className="mb-4 p-3 bg-slate-50 rounded-lg border border-slate-100 text-[11px] text-slate-600 space-y-1.5">
                                                <div className="flex justify-between items-center">
                                                    <span>{t('details.billingPeriodLabel')}</span>
                                                    <span className="font-semibold text-slate-800">
                                                        {localSub.billing_period === 'monthly'
                                                            ? t('details.billingPeriodMonthly')
                                                            : t('details.billingPeriodYearly')
                                                        }
                                                    </span>
                                                </div>
                                                {localSub.expires_at && (
                                                    <div className="flex justify-between items-center">
                                                        <span>{t('details.activeUntilLabel')}</span>
                                                        <span className="font-semibold text-slate-800">
                                                            {new Date(localSub.expires_at).toLocaleDateString(process.env.NEXT_FORMAT_LOCALE)}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Кнопка с динамическим текстом */}
                                        <button
                                            onClick={() => handleCheckout(tariff.id)}
                                            disabled={isCheckingOut === tariff.id || isActiveCurrent}
                                            className={`w-full py-2 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5
                                                ${isActiveCurrent ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-primary-600 hover:bg-primary-700 text-white shadow-sm'}
                                            `}
                                        >
                                            {!user ? (
                                                <><i className="fa-solid fa-right-to-bracket"></i> {t('button.loginToPay')}</>
                                            ) : isCheckingOut === tariff.id ? (
                                                <><i className="fa-solid fa-spinner fa-spin"></i> {t('button.processing')}</>
                                            ) : isActiveCurrent ? (
                                                t('button.currentTariff')
                                            ) : isTrialTariff ? (
                                                <><i className="fa-solid fa-crown"></i> {t('button.subscribe')}</>
                                            ) : isPrevious ? (
                                                <><i className="fa-solid fa-rotate-right"></i> {t('button.resume')}</>
                                            ) : (
                                                <><i className="fa-solid fa-credit-card"></i> {t('button.pay')}</>
                                            )}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}